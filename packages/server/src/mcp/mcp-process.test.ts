import { fileURLToPath } from 'node:url';

import { connectMcp, problemIn, withMcpSession, type McpClientKind, type McpSession } from '@on.auto/api/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { callInFlightLine } from '../testing/entries/calls-in-flight.ts';
import { aLineToTheTest } from '../testing/processes/lines-to-the-test.ts';
import { spawnServer, type SpawnedServer } from '../testing/processes/spawned-server.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';

const serveWithWaitingTool = fileURLToPath(new URL('../testing/entries/serve-with-waiting-tool.ts', import.meta.url));

const stopped = 'Auto Runtime stopped while it handled this request, so it may or may not have taken effect';

const currentRevision: McpClientKind = 'current revision';

let ledger: TemporaryLedger;

beforeEach(() => {
  ledger = temporaryLedger();
});

afterEach(() => {
  ledger.remove();
});

interface WaitingCall {
  readonly child: SpawnedServer;
  readonly port: number;
  readonly session: McpSession;
  readonly waiting: Promise<unknown>;
}

async function waitingCallOn(kind: McpClientKind): Promise<WaitingCall> {
  const line = await aLineToTheTest();
  const child = spawnServer(serveWithWaitingTool, {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ledger.fileName,
    ...line.environment,
  });
  const port = await child.port;
  await withMcpSession(kind, { url: `http://127.0.0.1:${port}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }),
  );
  const session = await connectMcp(kind, {
    url: `http://127.0.0.1:${port}/orgs/acme/playbooks/alpha/mcp`,
    headers: {},
  });
  const waiting = session.callTool('wait_forever', {}).then(
    (result) => ({ isError: result.isError, problem: problemIn(result) }),
    (error: unknown) => ({ ended: String(error) }),
  );
  await line.said(callInFlightLine, child.exited);
  return { child, port, session, waiting };
}

/*
 * Processes, one of each, since what they show is the process's own: SIGTERM reaching the shutdown that cuts a call
 * off, its exit code, and what it writes to stdout and stderr. How each revision of client is answered when the API
 * closes with its call in flight is a rule, proven in process for every revision in the api's mcp-revisions.test.ts.
 */
describe('a server process with an MCP call in flight', () => {
  it('answers the client whose call the shutdown on SIGTERM cuts off with an error that says it may or may not have taken effect, and exits 0', async () => {
    const { child, session, waiting } = await waitingCallOn(currentRevision);

    child.signal('SIGTERM');
    const answer = await waiting;
    const exitCode = await child.exited;
    await session.close();

    expect({ answer, exitCode }).toEqual({ answer: { ended: `ProtocolError: ${stopped}` }, exitCode: 0 });
  });

  it('writes nothing more to stdout or stderr when the client disconnects in the middle of the call', async () => {
    const { child, port, session, waiting } = await waitingCallOn(currentRevision);

    await session.close();
    const answer = await waiting;
    child.signal('SIGTERM');

    expect({ answer, exitCode: await child.exited }).toEqual({
      answer: { ended: 'SdkError: Connection closed' },
      exitCode: 0,
    });
    expect(child.output().stdout).toBe(`Auto Runtime listening on port ${port}\n`);
    expect(child.output().stderr).toMatch(/^\{"message":"Local mode is on: [^\n]*\}\n$/u);
  });
});
