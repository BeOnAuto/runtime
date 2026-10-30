import { describe, expect, it } from 'vitest';

import { initializeAt, jsonOf, messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

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
          message:
            'Bad Request: Unsupported protocol version: 2023-01-01 (supported versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07)',
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
          structuredContent: { name: 'old', text: 'hi' },
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
