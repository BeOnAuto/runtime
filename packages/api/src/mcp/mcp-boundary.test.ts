import { defineQuery, makeCatalog, makeDispatcher } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { guideShelfOf, mcpRoutes } from '../index.ts';
import { createTestHandler } from '../testing/api-calls.ts';
import { type Listening, listenOnLoopback } from '../testing/listening.ts';
import { type McpConnection, plainTextIn, problemIn, type ToolResult, withMcpSession } from '../testing/mcp-clients.ts';
import { notebookOperations } from '../testing/notebook.ts';
import {
  acmeAlphaWriter,
  acmeReader,
  operationServer,
  type OperationServer,
  testRetryStateKeys,
  testServerInfo,
} from '../testing/operation-server.ts';
import { guideToolName, listedTools, toolNamesIn } from '../testing/tool-listing.ts';

const sdkErrors: string[] = [];

const emptyShelf = guideShelfOf([], [], []);

const brokenRuntime = mcpRoutes({
  catalog: makeCatalog(notebookOperations),
  dispatcher: makeDispatcher([]),
  runCall: () => Promise.reject(new Error('the runtime broke while holding database password hunter2')),
  serverInfo: testServerInfo,
  retryStateKeys: testRetryStateKeys,
  shelf: emptyShelf,
  reportError: (error) => {
    sdkErrors.push(error.message);
  },
});

describe('a tool call that throws', () => {
  it('answers isError with an internal problem, and reports the error under its incident id', async () => {
    const { handler, reported } = createTestHandler({ routes: [brokenRuntime] });
    const listening = await listenOnLoopback(handler);

    const result = await withMcpSession(
      'current revision',
      { url: `${listening.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      (session) => session.callTool('list_notes'),
    );
    await listening.close();
    const [report] = reported;

    expect({ isError: result.isError, problem: problemIn(result) }).toEqual({
      isError: true,
      problem: {
        type: 'https://on.auto/problems/internal',
        title: 'Internal error',
        status: 500,
        detail: 'An unexpected error occurred',
        reason: 'internal',
        instance: `urn:uuid:${String(report?.incident)}`,
      },
    });
    expect(report?.message).toBe('the runtime broke while holding database password hunter2');
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(sdkErrors).toEqual([]);
    expect(plainTextIn(result)).toBe(
      `Could not list the notes: something went wrong inside the server. It was not caused by anything you did. If it happens again, whoever runs the server can look into it with this reference: ${String(report?.incident)}.`,
    );
  });
});

describe('a tool call on /mcp that throws', () => {
  it('names in its words what was asked of an operation whose input has no field, given only its playbook', async () => {
    const { handler, reported } = createTestHandler({ routes: [brokenRuntime] });
    const listening = await listenOnLoopback(handler);

    const result = await withMcpSession(
      'current revision',
      { url: `${listening.origin}/mcp`, headers: {} },
      (session) => session.callTool('latest_note', { playbook: 'alpha' }),
    );
    await listening.close();

    expect(result.isError).toBe(true);
    expect(plainTextIn(result)).toBe(
      `Could not read the latest note: something went wrong inside the server. It was not caused by anything you did. If it happens again, whoever runs the server can look into it with this reference: ${String(reported[0]?.incident)}.`,
    );
  });
});

describe('an operation without plain language', () => {
  it('cannot be served as an MCP tool, so no result falls back to bare JSON', () => {
    const bare = defineQuery('playbook', {
      name: 'bare_query',
      title: 'Bare query',
      description: 'Answers without plain language. Use it in tests. It answers nothing.',
      route: { method: 'GET', path: '/bare' },
      inputSchema: Schema.Struct({ size: Schema.Int }),
      outputSchema: Schema.Struct({ size: Schema.Int }),
      reasons: [],
      handle: ({ size }) => Effect.succeed({ size }),
    });
    const serving = mcpRoutes({
      catalog: makeCatalog([bare]),
      dispatcher: makeDispatcher([]),
      runCall: () => Promise.reject(new Error('not called')),
      serverInfo: testServerInfo,
      retryStateKeys: testRetryStateKeys,
      shelf: emptyShelf,
      reportError: () => {
        sdkErrors.push('unexpected');
      },
    });

    expect(() => createTestHandler({ routes: [serving] })).toThrow(
      'The operation bare_query has no plain language for the results of its MCP tool',
    );
  });
});

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer();
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function endpoint(path: string, key: string): McpConnection {
  return { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${key}` } };
}

function problemOf(result: ToolResult): unknown {
  return { isError: result.isError, problem: problemIn(result) };
}

describe('the permissions of the caller of a tool', () => {
  it('list for a read-only key the queries and no command, in instructions that name no command', async () => {
    const outcome = await withMcpSession(
      'previous major',
      endpoint('/orgs/acme/playbooks/alpha/mcp', acmeReader.key),
      async (session) => ({
        tools: toolNamesIn(await session.listTools()),
        instructions: String(session.instructions),
        query: await session.callTool('list_notes'),
      }),
    );

    expect(outcome.tools).toEqual([
      'list_notes',
      'get_note',
      'latest_note',
      'break_down',
      'wait_forever',
      guideToolName,
    ]);
    expect(['add_note', 'check_lines', 'send_notes'].filter((name) => outcome.instructions.includes(name))).toEqual([]);
    expect(outcome.query.isError).toBeUndefined();
  });
});

describe('a command a read-only key is not offered', () => {
  it('is answered as a tool the endpoint does not list', async () => {
    await expect(
      withMcpSession('current revision', endpoint('/orgs/acme/playbooks/alpha/mcp', acmeReader.key), (session) =>
        session.callTool('add_note', { name: 'read-only', text: 'no' }),
      ),
    ).rejects.toThrow('Tool add_note not found');
  });
});

describe('the playbooks of the caller of a tool', () => {
  it('let a key limited to some playbooks call the tools of a playbook it may access', async () => {
    const added = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/playbooks/alpha/mcp', acmeAlphaWriter.key),
      (session) => session.callTool('add_note', { name: 'limited', text: 'yes' }),
    );

    expect(added.structuredContent).toEqual({ in_words: 'Added the note “limited”.', name: 'limited', text: 'yes' });
  });

  it('confine an org tool of a key limited to some playbooks to those playbooks', async () => {
    const labelled = await withMcpSession(
      'previous revision',
      endpoint('/orgs/acme/mcp', acmeAlphaWriter.key),
      async (session) => ({
        own: await session.callTool('label_playbook', { playbook: 'alpha', label: 'a' }),
        other: await session.callTool('label_playbook', { playbook: 'beta', label: 'b' }),
      }),
    );

    expect(labelled.own.structuredContent).toEqual({
      in_words: 'Done: label a playbook.',
      playbook: 'alpha',
      label: 'a',
    });
    expect(problemOf(labelled.other)).toMatchObject({ isError: true, problem: { reason: 'forbidden' } });
  });
});

describe('the playbook endpoint of a playbook that does not exist', () => {
  it('lists the playbook tools and answers a call with a not_found problem', async () => {
    const outcome = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/playbooks/nowhere/mcp', acmeReader.key),
      async (session) => ({
        tools: listedTools(await session.listTools()).length,
        called: await session.callTool('list_notes'),
      }),
    );

    expect(outcome.tools).toBeGreaterThan(0);
    expect(problemOf(outcome.called)).toEqual({
      isError: true,
      problem: {
        type: 'https://on.auto/problems/not_found',
        title: 'Not found',
        status: 404,
        detail: 'There is no playbook nowhere in this org',
        reason: 'not_found',
      },
    });
  });
});
