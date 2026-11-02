import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { mcpClientKinds, withMcpSession, type McpClientKind, type McpSession } from '../testing/mcp-clients.ts';
import { messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { acmeAdmin, acmeReader, operationServer, type OperationServer } from '../testing/operation-server.ts';

const making = {
  title: 'Make',
  description: 'Makes something. Use it to make one. It answers that it did.',
  inputSchema: Schema.Struct({ what: Schema.optionalKey(Schema.String.annotate({ description: 'What to make' })) }),
  outputSchema: Schema.Struct({ made: Schema.Boolean }),
  reasons: [],
  handle: () => Effect.succeed({ made: true }),
  plainLanguage: { task: 'make', attempt: () => 'make', outcome: () => 'Made.' },
} as const;

const playbookTools: ReadonlySet<string> = new Set(['create_definition', 'run_definition']);

function commandNamed(name: string) {
  const route = { method: 'POST', path: `/${name.replaceAll('_', '-')}` } as const;
  return playbookTools.has(name)
    ? defineCommand('playbook', { name, route, ...making })
    : defineCommand('org', { name, route, ...making });
}

interface Served {
  readonly server: OperationServer;
  readonly listening: Listening;
}

let every: Served;
let noRuns: Served;

async function servedWith(tools: readonly string[]): Promise<Served> {
  const server = await operationServer({
    operations: [...notebookOperations, ...tools.map((name) => commandNamed(name))],
  });
  return { server, listening: await listenOnLoopback(server.handler) };
}

beforeAll(async () => {
  every = await servedWith(['create_playbook', 'add_connection', 'create_definition', 'run_definition']);
  noRuns = await servedWith(['create_playbook', 'add_connection', 'create_definition']);
});

async function closed({ server, listening }: Served): Promise<void> {
  await listening.close();
  await server.runtime.dispose();
}

afterAll(async () => {
  await Promise.all([closed(every), closed(noRuns)]);
});

function onMcp<T>(
  served: Served,
  path: string,
  use: (session: McpSession) => Promise<T>,
  { kind = 'current revision', key = acmeAdmin.key }: Readonly<{ kind?: McpClientKind; key?: string }> = {},
): Promise<T> {
  return withMcpSession(
    kind,
    { url: `${served.listening.origin}${path}`, headers: { authorization: `Bearer ${key}` } },
    use,
  );
}

const PromptsSchema = Schema.Struct({ prompts: Schema.Array(Schema.Struct({ name: Schema.String })) });

const ListedSchema = Schema.Struct({ prompts: Schema.Array(Schema.Unknown) });

async function promptNamesOn(served: Served, path: string, key = acmeAdmin.key): Promise<readonly string[]> {
  const listed = await onMcp(served, path, (session) => session.listPrompts(), { key });
  return Schema.decodeUnknownSync(PromptsSchema)(listed).prompts.map(({ name }) => name);
}

const listedStarts = [
  {
    name: 'get-started',
    title: 'Get started with Auto',
    description:
      'Creates a first playbook with one function, runs it on a made-up example and links the run in Studio.',
    arguments: [],
  },
  {
    name: 'connect-a-service',
    title: 'Connect a service',
    description: 'Connects a service the team uses to Auto, and says what it can do once it is connected.',
    arguments: [
      { name: 'service', description: 'The service to connect, such as Slack or Google Drive', required: true },
    ],
  },
];

function askOf(text: string) {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}

describe.each(mcpClientKinds)('the starting prompts on /mcp, for the %s client', (kind) => {
  it('are listed first, with their titles, descriptions and arguments, where every tool each asks for is', async () => {
    const { prompts } = Schema.decodeUnknownSync(ListedSchema)(
      await onMcp(every, '/mcp', (session) => session.listPrompts(), { kind }),
    );

    expect(prompts.slice(0, listedStarts.length)).toMatchObject(listedStarts);
  });

  it('answer with one ask of the person, the service filled in', async () => {
    const answers = await onMcp(
      every,
      '/mcp',
      async (session) => [
        await session.getPrompt('get-started'),
        await session.getPrompt('connect-a-service', { service: 'Slack' }),
      ],
      { kind },
    );

    expect(answers).toMatchObject([
      askOf(
        'Create a playbook in Auto with one function and run it on a made-up example. Ask me what the playbook is for and anything else you need first, then give me a link to the run in Studio.',
      ),
      askOf('Connect Slack to Auto for my team, then tell me what it can do.'),
    ]);
  });
});

describe('the starting prompts of a connection', () => {
  it('are each offered only where every tool it asks for is listed: on an org endpoint connecting a service alone, and none on a playbook endpoint or to a key that may only read', async () => {
    const offered = await Promise.all([
      promptNamesOn(every, '/orgs/acme/mcp'),
      promptNamesOn(every, '/orgs/acme/playbooks/alpha/mcp'),
      promptNamesOn(every, '/mcp', acmeReader.key),
      promptNamesOn(noRuns, '/mcp'),
    ]);

    expect(offered).toEqual([['connect-a-service'], ['take-a-note'], [], ['connect-a-service', 'take-a-note']]);
  });

  it('leave out a prompt the connection cannot follow, as a prompt it does not have', async () => {
    await expect(onMcp(every, '/orgs/acme/mcp', (session) => session.getPrompt('get-started'))).rejects.toThrow(
      /Prompt get-started not found/u,
    );
  });
});

describe('connecting a service asked without the service', () => {
  it('is a protocol error that names the argument', async () => {
    const answer = await postMcp(
      every.server.handler,
      '/mcp',
      { authorization: `Bearer ${acmeAdmin.key}`, 'mcp-protocol-version': '2025-11-25' },
      requestOf(1, 'prompts/get', { name: 'connect-a-service', arguments: {} }),
    );

    expect(JSON.stringify(messagesIn(answer))).toMatch(
      /"code":-32602,"message":"Invalid arguments for prompt connect-a-service: [^"]*service/u,
    );
  });
});
