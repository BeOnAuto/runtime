import type { RequestId } from '@modelcontextprotocol/server';
import { Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { answersHeard } from '../testing/answers-heard.ts';
import { listenOnLoopback } from '../testing/listening.ts';
import { connectMcp, mcpClientKinds } from '../testing/mcp-clients.ts';
import { notebookOperationsAnnouncingWaits } from '../testing/notebook.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';
import { hearingFetch } from './hearing-fetch.ts';

describe('a call an MCP endpoint is still answering', () => {
  it.each(mcpClientKinds)('streams its answer to a client of the %s, with a heartbeat while it runs', async (kind) => {
    const calling = Promise.withResolvers<void>();
    const server = await operationServer({
      operations: notebookOperationsAnnouncingWaits(calling.resolve),
      heartbeatEveryMs: 20,
    });
    const listening = await listenOnLoopback(server.handler);
    onTestFinished(async () => {
      await listening.close();
      await server.runtime.dispose();
    });
    const answers = answersHeard();
    const session = await connectMcp(kind, {
      url: `${listening.origin}/orgs/acme/playbooks/alpha/mcp`,
      headers: { authorization: `Bearer ${acmeAdmin.key}` },
      fetch: answers.fetch,
    });

    const waiting = session.callTool('wait_forever', {}).catch(Function.constVoid);
    await calling.promise;

    await expect(answers.heard(': keepalive\n\n')).resolves.toBeUndefined();
    await session.close();
    await waiting;
  });
});

function streaming(pieces: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start: (controller) => {
        for (const piece of pieces) {
          controller.enqueue(encoder.encode(piece));
        }
        controller.close();
      },
    }),
    { status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream' } },
  );
}

type Asked = readonly [string, { readonly method: string; readonly body?: string }?];

interface Hearing {
  readonly heard: string[];
  readonly fetch: (...args: Asked) => Promise<Response>;
}

function hearing(answer: () => Response): Hearing {
  const decoder = new TextDecoder();
  const heard: string[] = [];
  const said = (id: RequestId, what: string) => {
    heard.push(`${String(id)} ${what}`);
  };
  return {
    heard,
    fetch: hearingFetch<Asked>(
      () => Promise.resolve(answer()),
      (id) => {
        said(id, 'answers');
        return {
          piece: (piece) => {
            said(id, decoder.decode(piece));
          },
          ended: () => {
            said(id, 'ended');
          },
        };
      },
    ),
  };
}

const callTool = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} });

describe('the answers a hearing fetch hears', () => {
  it('are heard by the id of their request, once their headers come, at each piece of their stream and at its end', async () => {
    const { heard, fetch } = hearing(() => streaming([': keepalive\n\n', 'data: {}\n\n']));

    const answer = await fetch('http://127.0.0.1:5555/mcp', { method: 'POST', body: callTool });
    const text = await answer.text();

    expect(text).toBe(': keepalive\n\ndata: {}\n\n');
    expect(heard).toEqual(['3 answers', '3 : keepalive\n\n', '3 data: {}\n\n', '3 ended']);
    expect({ status: answer.status, type: answer.headers.get('content-type') }).toEqual({
      status: 200,
      type: 'text/event-stream',
    });
  });

  it('are passed on unheard when they answer no request, such as a notification or the opening of a stream', async () => {
    const { heard, fetch } = hearing(() => new Response(null, { status: 202 }));

    const notified = await fetch('http://127.0.0.1:5555/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    const opened = await fetch('http://127.0.0.1:5555/mcp', { method: 'GET' });

    expect([notified.status, opened.status]).toEqual([202, 202]);
    expect(heard).toEqual([]);
  });

  it('are heard once, at their headers, when they have no body', async () => {
    const { heard, fetch } = hearing(() => new Response(null, { status: 204 }));

    const answer = await fetch('http://127.0.0.1:5555/mcp', { method: 'POST', body: callTool });

    expect([answer.status, answer.body]).toEqual([204, null]);
    expect(heard).toEqual(['3 answers']);
  });
});
