import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectMcp, problemIn, withMcpSession, type McpClientKind, type McpSession } from '@on.auto/api/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { callInFlightFileVariable } from '../testing/entries/calls-in-flight.ts';
import { spawnServer, untilCallInFlight, type SpawnedServer } from '../testing/processes/spawned-server.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';

const serveWithWaitingTool = fileURLToPath(new URL('../testing/entries/serve-with-waiting-tool.ts', import.meta.url));

const stopped = 'Auto Runtime stopped while it handled this request, so it may or may not have taken effect';

const clientsCutOff: ReadonlyArray<readonly [McpClientKind, string]> = [
  ['current revision', `ProtocolError: ${stopped}`],
  ['previous revision', `ProtocolError: ${stopped}`],
  ['previous major', `McpError: MCP error -32603: ${stopped}`],
];

const clientsClosing: ReadonlyArray<readonly [McpClientKind, string]> = [
  ['current revision', 'SdkError: Connection closed'],
  ['previous revision', 'SdkError: Connection closed'],
  ['previous major', 'McpError: MCP error -32000: Connection closed'],
];

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
  const inFlight = join(ledger.directory, 'call-in-flight');
  const child = spawnServer(serveWithWaitingTool, {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ledger.fileName,
    [callInFlightFileVariable]: inFlight,
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
  await untilCallInFlight(inFlight);
  return { child, port, session, waiting };
}

describe('a server process with an MCP call in flight', () => {
  it.each(clientsCutOff)(
    'answers the %s client, whose call the shutdown cuts off, with an error that says it may or may not have taken effect, and exits 0',
    async (kind, answered) => {
      const { child, session, waiting } = await waitingCallOn(kind);

      child.signal('SIGTERM');
      const answer = await waiting;
      const exitCode = await child.exited;
      await session.close();

      expect({ answer, exitCode }).toEqual({ answer: { ended: answered }, exitCode: 0 });
    },
  );

  it.each(clientsClosing)(
    'writes nothing more to stdout or stderr when the %s client disconnects in the middle of the call',
    async (kind, ended) => {
      const { child, port, session, waiting } = await waitingCallOn(kind);

      await session.close();
      const answer = await waiting;
      child.signal('SIGTERM');

      expect({ answer, exitCode: await child.exited }).toEqual({ answer: { ended }, exitCode: 0 });
      expect(child.output().stdout).toBe(`Auto Runtime listening on port ${port}\n`);
      expect(child.output().stderr).toMatch(/^\{"message":"Local mode is on: [^\n]*\}\n$/u);
    },
  );
});
