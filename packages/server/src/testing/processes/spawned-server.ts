import { once } from 'node:events';
import { existsSync, watch } from 'node:fs';

import { spawnForTheTest } from '@on.auto/operations/testing';

import { callInFlightLine } from '../entries/calls-in-flight.ts';
import { noConsentThroughAuto } from '../settings/no-consent-through-auto.ts';
import { heardUntilItExits, somethingHappened } from '../waiting/happenings.ts';
import { aLineToTheTest, type LineToTheTest } from './lines-to-the-test.ts';

export interface SpawnedServer {
  readonly port: Promise<number>;
  readonly exited: Promise<unknown>;
  readonly output: () => { readonly stdout: string; readonly stderr: string };
  readonly signal: (name: NodeJS.Signals) => void;
}

interface HeldAnswer {
  readonly status: number;
  readonly body: unknown;
}

export interface HoldingServer {
  readonly child: SpawnedServer;
  readonly port: number;
  readonly answer: Promise<HeldAnswer | 'unanswered'>;
  /** The line the server's test entry says what it did on. */
  readonly line: LineToTheTest;
}

/**
 * Tells the waiting tests of each append of a server in another process, by the log of its ledger file, until it
 * exits: the test can read what the server recorded then. A server whose ledger is in memory or elsewhere has no log
 * here, and its output is what tells.
 */
function recordsWatched(log: string, exited: Promise<unknown>): boolean {
  const kept = existsSync(log);
  if (kept) {
    const recorded = watch(log, somethingHappened);
    void exited.finally(() => {
      recorded.close();
    });
  }
  return kept;
}

export function spawnServer(entry: string, env: Readonly<Record<string, string>>): SpawnedServer {
  const child = spawnForTheTest(process.execPath, [entry], {
    env: {
      NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'],
      DO_NOT_TRACK: '1',
      ...noConsentThroughAuto,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  const { promise: port, resolve: announce } = Promise.withResolvers<number>();
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    output.stdout += chunk;
    announce(Number(/port (\d+)/u.exec(output.stdout)?.[1]));
    somethingHappened();
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    output.stderr += chunk;
    somethingHappened();
  });
  const exited = once(child, 'close').then(([code]: readonly unknown[]) => code);
  heardUntilItExits(exited);
  void port.then(() => recordsWatched(`${String(env['LEDGER_FILE'])}-wal`, exited));
  return {
    port,
    exited,
    output: () => ({ ...output }),
    signal: (name) => {
      child.kill(name);
    },
  };
}

export async function serverHoldingARequest(
  entry: string,
  environment: Readonly<Record<string, string>>,
): Promise<HoldingServer> {
  const line = await aLineToTheTest();
  const child = spawnServer(entry, { HOST: '127.0.0.1', PORT: '0', ...line.environment, ...environment });
  const port = await child.port;
  const answer = fetch(`http://127.0.0.1:${port}/held`).then(
    async (response): Promise<HeldAnswer> => ({ status: response.status, body: await response.json() }),
    (): 'unanswered' => 'unanswered',
  );
  await line.said(callInFlightLine, child.exited);
  return { child, port, answer, line };
}
