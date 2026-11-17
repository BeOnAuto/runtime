import { describe, expect, it, onTestFinished } from 'vitest';

import { stoppedWords } from '../answer-streams/answers-at-stop.ts';
import type { RegisterRoutes } from '../index.ts';
import { createTestHandler } from '../testing/api-calls.ts';
import { exchanged, listenOnLoopback } from '../testing/listening.ts';
import { connectMcp, mcpClientKinds } from '../testing/mcp-clients.ts';
import { initializeAt, jsonOf, messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import { notebookOperationsAnnouncingWaits } from '../testing/notebook.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';

const anyWords: unknown = expect.any(String);

const playbookEndpoint = '/orgs/acme/playbooks/alpha/mcp';

async function listening(server: OperationServer): Promise<string> {
  const served = await listenOnLoopback(server.handler);
  onTestFinished(async () => {
    await served.close();
    await server.runtime.dispose();
  });
  return served.origin;
}

describe('closing the API', () => {
  it('closes what every route registered for closing', async () => {
    const closed: string[] = [];
    const closing: RegisterRoutes = (routes) => {
      routes.onClose(() => {
        closed.push('closed');
        return Promise.resolve();
      });
    };
    const { handler } = createTestHandler({ routes: [closing, closing] });

    await handler.close();

    expect(closed).toEqual(['closed', 'closed']);
  });
});

describe('closing the API with a call in flight on an MCP endpoint', () => {
  it.each(mcpClientKinds)(
    'answers a call that a client of the %s still waits on with an error that says it may or may not have taken effect, and reports no incident',
    async (kind) => {
      const calling = Promise.withResolvers<void>();
      const server = await operationServer({ operations: notebookOperationsAnnouncingWaits(calling.resolve) });
      const origin = await listening(server);
      const session = await connectMcp(kind, {
        url: `${origin}${playbookEndpoint}`,
        headers: { authorization: `Bearer ${acmeAdmin.key}` },
      });
      const waiting = session.callTool('wait_forever', {});
      await calling.promise;

      await server.handler.close();

      await expect(waiting).rejects.toThrow(stoppedWords);
      expect(server.incidents()).toEqual([]);
      await session.close();
    },
  );
});

describe('closing the API before a request comes to an MCP endpoint', () => {
  it('turns away a request that comes once it closed with a 503 problem that says the server is stopping', async () => {
    const server = await operationServer();
    const origin = await listening(server);

    await server.handler.close();
    const answer = await exchanged(origin, playbookEndpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${acmeAdmin.key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const body: unknown = JSON.parse(answer.body);

    expect({ status: answer.status, body }).toEqual({
      status: 503,
      body: {
        type: 'https://on.auto/problems/unavailable',
        title: 'Unavailable',
        status: 503,
        detail: 'The server is stopping',
        reason: 'unavailable',
      },
    });
  });
});

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const alpha = '/orgs/acme/playbooks/alpha/mcp';

const olderRevisions = ['2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];

function under(protocolVersion: string): Readonly<Record<string, string>> {
  return { ...asAdmin, 'mcp-protocol-version': protocolVersion };
}

function toolCall(id: number, name: string, input: Readonly<Record<string, unknown>>): string {
  return requestOf(id, 'tools/call', { name, arguments: input });
}

describe('the protocol revisions of an MCP endpoint', () => {
  it.each(['2025-11-25', ...olderRevisions])('answers an initialize in %s in that revision', async (revision) => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/mcp', asAdmin, initializeAt(revision));

    expect(messagesIn(answer)).toMatchObject([{ result: { protocolVersion: revision } }]);
  });

  it('offers 2025-11-25 to a client that asks for a revision the SDK does not know', async () => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/mcp', asAdmin, initializeAt('2023-01-01'));

    expect(messagesIn(answer)).toMatchObject([{ result: { protocolVersion: '2025-11-25' } }]);
  });

  it('rejects a request made under a revision the SDK does not know with its own JSON-RPC error and 400', async () => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/mcp', under('2023-01-01'), requestOf(2, 'tools/list'));

    expect({ status: answer.status, body: jsonOf(answer.text) }).toEqual({
      status: 400,
      body: {
        jsonrpc: '2.0',
        error: {
          code: -32_000,
          message: anyWords,
        },
        id: null,
      },
    });
  });

  it.each(olderRevisions)('lists under %s the same tools as under 2025-11-25', async (revision) => {
    const { handler } = await operationServer();

    const older = await postMcp(handler, alpha, under(revision), requestOf(2, 'tools/list'));
    const previous = await postMcp(handler, alpha, under('2025-11-25'), requestOf(2, 'tools/list'));

    expect(messagesIn(older)).toEqual(messagesIn(previous));
  });
});

describe('a tool call under 2024-11-05', () => {
  it('answers a success with structured content, a rejection as isError, and an unknown tool as -32602', async () => {
    const { handler } = await operationServer();
    const headers = under('2024-11-05');

    const added = await postMcp(handler, alpha, headers, toolCall(3, 'add_note', { name: 'old', text: 'hi' }));
    const missing = await postMcp(handler, alpha, headers, toolCall(4, 'get_note', { name: 'missing' }));
    const unknown = await postMcp(handler, alpha, headers, toolCall(5, 'no_such_tool', {}));

    expect([...messagesIn(added), ...messagesIn(missing), ...messagesIn(unknown)]).toEqual([
      {
        jsonrpc: '2.0',
        id: 3,
        result: {
          content: [
            { type: 'text', text: 'Added the note “old”.' },
            { type: 'text', text: '{"name":"old","text":"hi"}' },
          ],
          structuredContent: { in_words: 'Added the note “old”.', name: 'old', text: 'hi' },
        },
      },
      {
        jsonrpc: '2.0',
        id: 4,
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Could not read the note “missing”: it, or something it refers to, could not be found. Check the names used; the details below say what is missing.',
            },
            {
              type: 'text',
              text: '{"type":"https://on.auto/problems/not_found","title":"Not found","status":404,"detail":"There is no note missing","reason":"not_found"}',
            },
          ],
        },
      },
      { jsonrpc: '2.0', id: 5, error: { code: -32_602, message: 'Tool no_such_tool not found' } },
    ]);
  });
});
