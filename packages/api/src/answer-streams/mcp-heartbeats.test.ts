import { Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { answersHeard } from '../testing/answers-heard.ts';
import { listenOnLoopback } from '../testing/listening.ts';
import { connectMcp, mcpClientKinds } from '../testing/mcp-clients.ts';
import { notebookOperationsAnnouncingWaits } from '../testing/notebook.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

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
