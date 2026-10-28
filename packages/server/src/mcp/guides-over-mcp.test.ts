import { Buffer } from 'node:buffer';

import { withMcpSession, type McpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;

function onMcp<T>(use: (session: McpSession) => Promise<T>, path = '/mcp'): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, use);
}

beforeAll(async () => {
  server = await servingReasoning([]);
});

afterAll(async () => {
  await server.stop();
});

const ResourcesSchema = Schema.Struct({
  resources: Schema.Array(Schema.Struct({ uri: Schema.String, name: Schema.String, mimeType: Schema.String })),
});

const ContentsSchema = Schema.Struct({ contents: Schema.Array(Schema.Struct({ text: Schema.String })) });

const TextSchema = Schema.Struct({ content: Schema.Array(Schema.Struct({ text: Schema.String })) });

const guideNames = [
  'terminology',
  'reasoning-function',
  'interaction-function',
  'computation-function',
  'recall-function',
  'prediction-function',
  'workflow',
  'templates',
  'voice',
  'first-playbook',
  'remember',
  'give-tools',
  'schedule',
];

async function guidesServed(session: McpSession) {
  const { resources } = Schema.decodeUnknownSync(ResourcesSchema)(await session.listResources());
  const read = await Promise.all(
    resources.map(async ({ uri }) => Schema.decodeUnknownSync(ContentsSchema)(await session.readResource(uri))),
  );
  const called = await Promise.all(
    resources.map(async ({ name }) =>
      Schema.decodeUnknownSync(TextSchema)(await session.callTool('get_guide', { guide: name })),
    ),
  );
  return {
    resources,
    read: read.map(({ contents }) => contents.map(({ text }) => text).join('')),
    called: called.map(({ content }) => content.map(({ text }) => text).join('')),
  };
}

describe('the guides of the server', () => {
  it('are the same names, with the same text, as resources and through get_guide, each under 64 KiB', async () => {
    const { resources, read, called } = await onMcp(guidesServed);

    expect(resources.map(({ uri, name, mimeType }) => [uri, name, mimeType])).toEqual(
      guideNames.map((name) => [`guide://${name}`, name, 'text/markdown']),
    );
    expect(called).toEqual(read);
    expect(read.filter((text) => Buffer.byteLength(text, 'utf8') > 65_536)).toEqual([]);
    expect(read[1]).toMatch(/\n\nOn this server, no model provider is configured yet[^\n]*\n$/u);
  });
});

const PromptsSchema = Schema.Struct({
  prompts: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      title: Schema.String,
      arguments: Schema.Array(Schema.Struct({ name: Schema.String, required: Schema.Boolean })),
    }),
  ),
});

const PromptSchema = Schema.Struct({
  messages: Schema.Tuple([
    Schema.Struct({ role: Schema.String, content: Schema.Struct({ type: Schema.String, text: Schema.String }) }),
    Schema.Struct({
      role: Schema.String,
      content: Schema.Struct({
        type: Schema.String,
        resource: Schema.Struct({ uri: Schema.String, mimeType: Schema.String }),
      }),
    }),
  ]),
});

describe('the prompts of the server', () => {
  it('are the four recipes, with their titles and arguments', async () => {
    const { prompts } = Schema.decodeUnknownSync(PromptsSchema)(await onMcp((session) => session.listPrompts()));

    expect(
      prompts.map(({ name, title, arguments: given }) => [
        name,
        title,
        given.map(({ name: argument, required }) => [argument, required]),
      ]),
    ).toEqual([
      ['first-playbook', 'Create your first playbook', []],
      ['remember', 'Make the playbook remember something', [['what', true]]],
      ['give-tools', 'Give the playbook tools', [['server', false]]],
      [
        'schedule',
        'Run a workflow on a schedule',
        [
          ['workflow', true],
          ['when', true],
        ],
      ],
    ]);
  });

  it('answer the recipe with the words of the person filled in, then the guide it needs as an embedded resource', async () => {
    const {
      messages: [asked, embedded],
    } = Schema.decodeUnknownSync(PromptSchema)(
      await onMcp((session) => session.getPrompt('remember', { what: 'what it posted today' })),
    );

    expect([asked.role, asked.content.type, embedded.role, embedded.content]).toEqual([
      'user',
      'text',
      'user',
      { type: 'resource', resource: { uri: 'guide://recall-function', mimeType: 'text/markdown' } },
    ]);
    expect(asked.content.text).toMatch(
      /^Make the playbook remember what it posted today\.\n\n# Make the playbook remember something\n/u,
    );
  });
});

describe('the first-playbook prompt of the server', () => {
  it('answers the recipe get_guide reads, its workflow steps among them, and embeds the reasoning-function guide', async () => {
    const { prompt, read } = await onMcp(async (session) => ({
      prompt: Schema.decodeUnknownSync(PromptSchema)(await session.getPrompt('first-playbook')),
      read: Schema.decodeUnknownSync(TextSchema)(await session.callTool('get_guide', { guide: 'first-playbook' })),
    }));
    const [asked, embedded] = prompt.messages;
    const recipe = read.content.map(({ text }) => text).join('');

    expect(asked.content.text).toBe(`Create my first playbook.\n\n${recipe}`);
    expect(recipe).toContain(
      '\n7. Where the work starts on its own, read the workflow guide with get_guide and write the workflow that runs the function,',
    );
    expect(recipe).toContain('publish the material they paste with publish_event');
    expect(embedded.content.resource.uri).toBe('guide://reasoning-function');
  });
});

const PromptNamesSchema = Schema.Struct({ prompts: Schema.Array(Schema.Struct({ name: Schema.String })) });

function promptNamesIn(listed: unknown): readonly string[] {
  return Schema.decodeUnknownSync(PromptNamesSchema)(listed).prompts.map(({ name }) => name);
}

const acmeReader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: '*',
});

describe('the prompts of a connection', () => {
  it('are the recipes whose every tool it lists: on a playbook endpoint, all but making a first playbook, and on an org endpoint none', async () => {
    const [onAPlaybook, onAnOrg] = await Promise.all([
      onMcp((session) => session.listPrompts(), '/orgs/local/playbooks/alpha/mcp'),
      onMcp((session) => session.listPrompts(), '/orgs/local/mcp'),
    ]);

    expect([promptNamesIn(onAPlaybook), promptNamesIn(onAnOrg)]).toEqual([['remember', 'give-tools', 'schedule'], []]);
  });

  it('are none for a key that may only read, whose instructions name no recipe either', async () => {
    const reading = await servingReasoning([], { API_KEYS: JSON.stringify([acmeReader.entry]) });
    const served = await withMcpSession(
      'current revision',
      { url: `${reading.origin}/mcp`, headers: { authorization: `Bearer ${acmeReader.key}` } },
      async (session) => ({ prompts: await session.listPrompts(), instructions: String(session.instructions) }),
    );
    await reading.stop();

    expect(promptNamesIn(served.prompts)).toEqual([]);
    expect(served.instructions).not.toMatch(/recipe|first-playbook|give-tools/u);
  });
});
