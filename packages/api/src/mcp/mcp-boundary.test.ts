import { defineQuery, makeCatalog, makeDispatcher } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { guideShelfOf, mcpRoutes } from '../index.ts';
import { createTestHandler } from '../testing/api-calls.ts';
import { listenOnLoopback } from '../testing/listening.ts';
import { plainTextIn, problemIn, withMcpSession } from '../testing/mcp-clients.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { testRetryStateKeys, testServerInfo } from '../testing/operation-server.ts';

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
