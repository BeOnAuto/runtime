import { readFileSync } from 'node:fs';

import { instructionsFor, type McpEndpoint } from '@on.auto/api';
import {
  danglingReferencesIn,
  guideToolName,
  listedTools,
  problemIn,
  takingPlaybook,
  withMcpSession,
  type ListedTool,
  type McpSession,
} from '@on.auto/api/testing';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const playbookTools = ['create_playbook', 'list_playbooks', 'update_playbook', 'retire_playbook'];

const definitionTools = [
  'create_definition',
  'list_definitions',
  'get_definition',
  'update_definition',
  'retire_definition',
  'run_definition',
  'get_run',
  'cancel_run',
  'list_runs',
  'list_playbook_events',
  'get_event',
  'publish_event',
  'search',
  'introspect',
  'dry_run',
  'execute',
  'answer_interaction',
  'list_interactions',
  'send_run_event',
];

const connectionTools = ['add_connection', 'list_connections', 'remove_connection'];

const orgTools = [...playbookTools, 'list_models', 'search', ...connectionTools];

const insideAPlaybookAlone = definitionTools.filter((name) => !orgTools.includes(name));

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Summarize: {{ input.text }}',
].join('\n');

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function onMcp<T>(path: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, use);
}

function operations(tools: readonly ListedTool[]): readonly ListedTool[] {
  return tools.filter(({ name }) => name !== guideToolName);
}

function listingOn(path: string): Promise<readonly ListedTool[]> {
  return onMcp(path, async (session) => listedTools(await session.listTools()));
}

const playbookArgumentIn = Schema.decodeUnknownSync(
  Schema.Struct({
    required: Schema.Array(Schema.String),
    properties: Schema.Struct({ playbook: Schema.Struct({ type: Schema.String, pattern: Schema.String }) }),
  }),
);

describe('the playbook argument of the definition tools on /mcp', () => {
  it('is required in every one of them that only a playbook answers, as a string with the playbook id pattern', async () => {
    server = await servingReasoning([]);

    const definition = (await listingOn('/mcp')).filter(({ name }) => insideAPlaybookAlone.includes(name));
    const playbookArguments = definition.map(({ inputSchema }) => {
      const { required, properties } = playbookArgumentIn(inputSchema);
      const { type, pattern } = properties.playbook;
      return { required: required.includes('playbook'), type, pattern };
    });

    expect(playbookArguments).toEqual(
      insideAPlaybookAlone.map(() => ({ required: true, type: 'string', pattern: '^[a-z][a-z0-9-]{2,47}$' })),
    );
  });
});

describe('the tools of /mcp', () => {
  it('are the playbook tools, list_models, search and the definition tools, the definition tools taking a playbook, with self-contained input schemas', async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/local/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const [own, org, playbook] = [
      await listingOn('/mcp'),
      await listingOn('/orgs/local/mcp'),
      await listingOn('/orgs/local/playbooks/alpha/mcp'),
    ];
    const schemas = own.map(({ inputSchema }) => inputSchema);
    const onlyInPlaybook = operations(playbook).filter(({ name }) => insideAPlaybookAlone.includes(name));

    expect(own.map(({ name }) => name)).toEqual([...orgTools, ...insideAPlaybookAlone, guideToolName]);
    expect(operations(own)).toEqual([...operations(org), ...onlyInPlaybook.map((tool) => takingPlaybook(tool))]);
    expect(schemas.map((schema) => schema['type'])).toEqual(schemas.map(() => 'object'));
    expect(schemas.flatMap((schema) => danglingReferencesIn(schema))).toEqual([]);
  });
});

const definitionTypes = [
  { type: 'reasoning', noun: 'reasoning function', guide: 'reasoning-function' },
  { type: 'interaction', noun: 'interaction function', guide: 'interaction-function' },
  { type: 'computation', noun: 'computation function', guide: 'computation-function' },
  { type: 'recall', noun: 'recall function', guide: 'recall-function' },
  { type: 'prediction', noun: 'prediction function', guide: 'prediction-function' },
  { type: 'workflow', noun: 'workflow', guide: 'workflow' },
];

const terminology = readFileSync(new URL('../../../../docs/concepts/terminology.md', import.meta.url), 'utf8');

const resourcesOnTheTerminologyPage: ReadonlySet<string> = new Set(
  [...terminology.matchAll(/^\| \w+ +\| ([A-Z][a-z]+(?: function)?) +\| /gmu)].map(
    ([, resource = '']: readonly string[]) => resource.toLowerCase(),
  ),
);

interface Connection {
  readonly path: string;
  readonly endpoint: McpEndpoint;
  readonly served: { readonly orgTools: readonly string[]; readonly playbookTools: readonly string[] };
  readonly sentence: string;
  readonly unnamed: readonly string[];
}

const connections: readonly Connection[] = [
  {
    path: '/mcp',
    endpoint: 'own org',
    served: { orgTools, playbookTools: insideAPlaybookAlone },
    sentence: "This connection acts in the caller's own org: list_playbooks shows its playbooks",
    unnamed: [],
  },
  {
    path: '/orgs/acme/mcp',
    endpoint: 'org',
    served: { orgTools, playbookTools: [] },
    sentence: 'This connection manages the playbooks of one org: list_playbooks shows them',
    unnamed: ['create_definition', 'run_definition', 'get_run', 'dry_run', 'answer_interaction', 'send_run_event'],
  },
  {
    path: '/orgs/acme/playbooks/alpha/mcp',
    endpoint: 'playbook',
    served: { orgTools: [], playbookTools: definitionTools },
    sentence: 'This connection acts inside one playbook.',
    unnamed: ['create_playbook', 'list_playbooks', 'list_models'],
  },
];

describe('the instructions an agent receives when it connects', () => {
  it.each(connections)(
    'on $path say what a playbook, a definition and a run are, and name only the tools the endpoint serves',
    async ({ path, endpoint, served, sentence, unnamed }) => {
      server = await servingReasoning([]);
      await onMcp('/mcp', (session) => session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }));

      const instructions = await onMcp(path, (session) => Promise.resolve(session.instructions));

      expect(instructions).toBe(instructionsFor(endpoint, served, definitionTypes));
      expect(instructions).toContain(sentence);
      expect(unnamed.filter((name) => instructions?.includes(name) === true)).toEqual([]);
    },
  );

  it('leave each definition type to the tools that take one, which name it by the kind the terminology page gives it', async () => {
    server = await servingReasoning([]);

    const tools = await onMcp('/mcp', async (session) => listedTools(await session.listTools()));
    const createDefinition = tools.find(({ name }) => name === 'create_definition');

    expect(
      definitionTypes.filter(({ noun }: Readonly<{ noun: string }>) => !resourcesOnTheTerminologyPage.has(noun)),
    ).toEqual([]);
    expect(createDefinition?.inputSchema).toMatchObject({
      properties: { type: { enum: definitionTypes.map(({ type }: Readonly<{ type: string }>) => type) } },
    });
    expect(createDefinition?.inputSchema).toMatchObject({
      properties: { type: { description: "The definition's type" } },
    });
  });
});

function reachingOutside(tools: readonly ListedTool[]): readonly string[] {
  return tools.filter(({ annotations }) => annotations?.['openWorldHint'] === true).map(({ name }) => name);
}

describe('the open-world hint of the tools of /mcp', () => {
  it('is set for list_models and run_definition, which reach model providers, for the four tools over the tool servers, which reach them, and for no other tool', async () => {
    server = await servingReasoning([]);

    expect(reachingOutside(await listingOn('/mcp'))).toEqual([
      'list_models',
      'search',
      'run_definition',
      'introspect',
      'dry_run',
      'execute',
    ]);
  });
});

describe('one connection to /mcp', () => {
  it('creates a playbook, then creates, executes and reads back a reasoning function definition in it', async () => {
    server = await servingReasoning([answers(textResult('Profits rose.'))]);

    const outcome = await onMcp('/mcp', async (session) => {
      const playbook = await session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' });
      const definition = await session.callTool('create_definition', {
        playbook: 'alpha',
        type: 'reasoning',
        name: 'summary',
        source: summary,
      });
      const ran = await session.callTool('run_definition', {
        playbook: 'alpha',
        type: 'reasoning',
        name: 'summary',
        input: { text: 'the quarter' },
      });
      const run = await session.callTool('get_run', {
        playbook: 'alpha',
        run_id: String(ran.structuredContent?.['run_id']),
      });
      return { playbook, definition, ran, run };
    });

    expect(outcome.playbook.structuredContent).toMatchObject({ id: 'alpha', status: 'active' });
    expect(outcome.definition.structuredContent).toMatchObject({ type: 'reasoning', name: 'summary', version: 1 });
    expect(outcome.ran.structuredContent).toMatchObject({ status: 'succeeded', output: 'Profits rose.' });
    expect(outcome.run.structuredContent).toMatchObject({
      run_id: outcome.ran.structuredContent?.['run_id'],
      status: 'succeeded',
      output: 'Profits rose.',
      record: { prompt: { instructions: 'Be brief.', message: 'Summarize: the quarter' } },
    });
    expect(server.modelCalls()).toBe(1);
  });
});

describe('a definition tool on /mcp', () => {
  it('answers a call without a playbook, and with an unknown playbook, as isError', async () => {
    server = await servingReasoning([]);

    const outcome = await onMcp('/mcp', async (session) => ({
      without: await session.callTool('list_definitions', { type: 'reasoning' }),
      unknown: await session.callTool('list_definitions', { playbook: 'nowhere', type: 'reasoning' }),
    }));

    expect(problemIn(outcome.without)).toMatchObject({
      reason: 'invalid_input',
      errors: [{ detail: 'Missing key', pointer: '/playbook' }],
    });
    expect(problemIn(outcome.unknown)).toMatchObject({
      reason: 'not_found',
      detail: 'There is no playbook nowhere in this org',
    });
  });
});

describe('/mcp in local mode', () => {
  it('acts in the org local, whose playbooks the HTTP API lists', async () => {
    server = await servingReasoning([]);

    await onMcp('/mcp', (session) => session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }));
    const listed = await server.call('GET', '/v1/orgs/local/playbooks');

    expect(listed.body).toMatchObject({ playbooks: [{ id: 'alpha', created_by: 'local' }] });
  });
});
