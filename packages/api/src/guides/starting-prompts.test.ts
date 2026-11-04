import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { mcpClientKinds, withMcpSession, type McpClientKind, type McpSession } from '../testing/mcp-clients.ts';
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

  it('answer with one ask of the person', async () => {
    const answer = await onMcp(every, '/mcp', (session) => session.getPrompt('get-started'), { kind });

    expect(answer).toMatchObject(
      askOf(
        'Create a playbook in Auto with one function and run it on a made-up example. Ask me what the playbook is for and anything else you need first, then give me a link to the run in Studio.',
      ),
    );
  });
});

describe('the starting prompt of a connection', () => {
  it('is offered only where every tool it asks for is listed: not on an org endpoint, on a playbook endpoint, to a key that may only read, or where run_definition is not served', async () => {
    const offered = await Promise.all([
      promptNamesOn(every, '/orgs/acme/mcp'),
      promptNamesOn(every, '/orgs/acme/playbooks/alpha/mcp'),
      promptNamesOn(every, '/mcp', acmeReader.key),
      promptNamesOn(noRuns, '/mcp'),
    ]);

    expect(offered).toEqual([[], ['take-a-note'], [], ['take-a-note']]);
  });

  it('is left out where the connection cannot follow it, as a prompt it does not have', async () => {
    await expect(onMcp(every, '/orgs/acme/mcp', (session) => session.getPrompt('get-started'))).rejects.toThrow(
      /Prompt get-started not found/u,
    );
  });
});
