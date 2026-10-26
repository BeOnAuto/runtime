import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { instructionsFor, type RegisterRoutes } from '../index.ts';
import { createTestHandler } from '../testing/api-calls.ts';
import { testDefinitionTypes } from '../testing/guides.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import {
  expectedProtocolVersion,
  mcpClientKinds,
  problemIn,
  textOf,
  withMcpSession,
  type McpConnection,
} from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer, testServerInfo, type OperationServer } from '../testing/operation-server.ts';
import { toolNamesIn } from '../testing/tool-listing.ts';
import { advertisedSchema } from '../tools/tool-schema.ts';

const countSchema = { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] };

function countingServer(): McpServer {
  const counting = new McpServer({ name: 'counting', version: '1.0.0' });
  counting.registerTool(
    'count',
    {
      description: 'Counts to one.',
      inputSchema: advertisedSchema({ type: 'object' }),
      outputSchema: advertisedSchema(countSchema),
    },
    () => ({ content: [{ type: 'text', text: '{"count":1}' }], structuredContent: { count: 1 } }),
  );
  return counting;
}

const advertisingAnOutputSchema: RegisterRoutes = (routes) => {
  const counting = createMcpHandler(countingServer, { legacy: 'stateless' });
  routes.add('POST', '/counting/mcp', (c) => counting.fetch(c.req.raw));
  routes.onClose(() => counting.close());
};

let server: OperationServer;
let listening: Listening;
let advertising: Listening;

beforeAll(async () => {
  server = await operationServer();
  listening = await listenOnLoopback(server.handler);
  advertising = await listenOnLoopback(createTestHandler({ routes: [advertisingAnOutputSchema] }).handler);
});

afterAll(async () => {
  await Promise.all([listening.close(), advertising.close()]);
  await server.runtime.dispose();
});

function alphaEndpoint(): McpConnection {
  return {
    url: `${listening.origin}/orgs/acme/playbooks/alpha/mcp`,
    headers: { authorization: `Bearer ${acmeAdmin.key}` },
  };
}

const playbookTools = [
  'add_note',
  'check_lines',
  'list_notes',
  'get_note',
  'latest_note',
  'break_down',
  'wait_forever',
  'send_notes',
];

const internalProblem = {
  type: 'https://on.auto/problems/internal',
  title: 'Internal error',
  status: 500,
  detail: 'An unexpected error occurred',
  reason: 'internal',
};

describe.each(mcpClientKinds)('the %s client connecting to a playbook endpoint', (kind) => {
  it('negotiates the expected revision and learns the server identity and the instructions', async () => {
    const connected = await withMcpSession(kind, alphaEndpoint(), (session) =>
      Promise.resolve({
        protocolVersion: session.protocolVersion,
        serverVersion: session.serverVersion,
        instructions: session.instructions,
      }),
    );

    expect(connected).toEqual({
      protocolVersion: expectedProtocolVersion[kind],
      serverVersion: { ...testServerInfo, title: 'Auto Runtime' },
      instructions: `This connection acts as the key acme-admin in the org acme. ${instructionsFor('playbook', { orgTools: [], playbookTools }, testDefinitionTypes)}`,
    });
  });

  it('lists one tool per playbook operation', async () => {
    expect(toolNamesIn(await withMcpSession(kind, alphaEndpoint(), (session) => session.listTools()))).toEqual([
      ...playbookTools,
      'get_guide',
    ]);
  });
});

describe.each(mcpClientKinds)('the %s client calling tools that succeed', (kind) => {
  it('lists the tools, then calls a command and a query and accepts each result without compiling an output validator', async () => {
    const name = `note-${kind.replaceAll(' ', '-')}`;

    const outcome = await withMcpSession(kind, alphaEndpoint(), async (session) => {
      await session.listTools();
      return {
        added: await session.callTool('add_note', { name, text: 'hello' }),
        read: await session.callTool('get_note', { name }),
        compiled: session.compiledOutputSchemas(),
      };
    });

    expect(outcome.added).toEqual({
      content: [
        { type: 'text', text: `Added the note “${name}”.` },
        { type: 'text', text: JSON.stringify({ name, text: 'hello' }) },
      ],
      structuredContent: { name, text: 'hello' },
    });
    expect(outcome.read.structuredContent).toEqual({ name, text: 'hello' });
    expect(outcome.compiled).toEqual([]);
  });
});

describe.each(mcpClientKinds)('the %s client listing a tool with an output schema', (kind) => {
  it('records the output schema it compiles a validator from, and refuses the result checked against it', async () => {
    const compiled = await withMcpSession(
      kind,
      { url: `${advertising.origin}/counting/mcp`, headers: {} },
      async (session) => {
        await session.listTools();
        await expect(session.callTool('count', {})).rejects.toThrow(
          "Structured content does not match the tool's output schema: A result was checked against an advertised output schema",
        );
        return session.compiledOutputSchemas();
      },
    );

    expect(compiled).toMatchObject([countSchema]);
  });
});

describe.each(mcpClientKinds)('the %s client calling tools that do not succeed', (kind) => {
  it('gets a rejection as isError with the problem document as text and no structured content', async () => {
    const rejected = await withMcpSession(kind, alphaEndpoint(), (session) =>
      session.callTool('get_note', { name: 'missing' }),
    );

    expect({ isError: rejected.isError, structuredContent: rejected.structuredContent }).toEqual({
      isError: true,
      structuredContent: undefined,
    });
    expect(problemIn(rejected)).toEqual({
      type: 'https://on.auto/problems/not_found',
      title: 'Not found',
      status: 404,
      detail: 'There is no note missing',
      reason: 'not_found',
    });
  });

  it('gets a failure as isError with an internal problem identified only by its instance', async () => {
    const failed = await withMcpSession(kind, alphaEndpoint(), (session) => session.callTool('break_down', {}));

    expect({ isError: failed.isError, structuredContent: failed.structuredContent }).toEqual({
      isError: true,
      structuredContent: undefined,
    });
    expect(problemIn(failed)).toMatchObject(internalProblem);
    expect(textOf(failed)).toMatch(/"instance":"urn:uuid:[\da-f-]{36}"\}$/u);
    expect(textOf(failed)).not.toContain('hunter2');
  });

  it('gets invalid arguments as isError with an invalid_input problem pointing at them', async () => {
    const rejected = await withMcpSession(kind, alphaEndpoint(), (session) =>
      session.callTool('add_note', { name: 42 }),
    );

    expect(rejected.isError).toBe(true);
    expect(problemIn(rejected)).toMatchObject({
      reason: 'invalid_input',
      errors: [{ pointer: '/name' }, { pointer: '/text' }],
    });
  });

  it('gets a protocol error for a tool the endpoint does not list', async () => {
    await expect(
      withMcpSession(kind, alphaEndpoint(), (session) => session.callTool('no_such_tool', {})),
    ).rejects.toThrow('Tool no_such_tool not found');
  });
});
