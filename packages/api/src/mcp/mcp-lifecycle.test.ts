import { describe, expect, it, onTestFinished } from 'vitest';

import { stoppedWords } from '../answer-streams/answers-at-stop.ts';
import type { RegisterRoutes } from '../index.ts';
import { createTestHandler } from '../testing/api-calls.ts';
import { exchanged, listenOnLoopback } from '../testing/listening.ts';
import { connectMcp, mcpClientKinds } from '../testing/mcp-clients.ts';
import { notebookOperationsAnnouncingWaits } from '../testing/notebook.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';

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
