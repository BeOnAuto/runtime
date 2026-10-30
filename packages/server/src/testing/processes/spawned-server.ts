import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { onTestFinished } from 'vitest';

import { callInFlightFileVariable } from '../entries/calls-in-flight.ts';
import { noConsentThroughAuto } from '../settings/no-consent-through-auto.ts';
import { until } from '../waiting/until.ts';

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
  readonly abandon: () => void;
}

function folderOfTheTest(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

export function spawnServer(entry: string, env: Readonly<Record<string, string>>): SpawnedServer {
  const child = spawnForTheTest(process.execPath, [entry], {
    env: {
      NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'],
      PREDICTION_CACHE_DIR: folderOfTheTest('auto-runtime-test-cache-'),
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
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    output.stderr += chunk;
  });
  const exited = once(child, 'close').then(([code]: readonly unknown[]) => code);
  return {
    port,
    exited,
    output: () => ({ ...output }),
    signal: (name) => {
      child.kill(name);
    },
  };
}

export async function untilCallInFlight(file: string): Promise<void> {
  await until(() => existsSync(file), Boolean);
}

export async function serverHoldingARequest(
  entry: string,
  environment: Readonly<Record<string, string>>,
): Promise<HoldingServer> {
  const inFlight = join(folderOfTheTest('auto-runtime-held-'), 'call-in-flight');
  const child = spawnServer(entry, {
    HOST: '127.0.0.1',
    PORT: '0',
    [callInFlightFileVariable]: inFlight,
    ...environment,
  });
  const port = await child.port;
  const client = new AbortController();
  const answer = fetch(`http://127.0.0.1:${port}/held`, { signal: client.signal }).then(
    async (response): Promise<HeldAnswer> => ({ status: response.status, body: await response.json() }),
    (): 'unanswered' => 'unanswered',
  );
  await untilCallInFlight(inFlight);
  return {
    child,
    port,
    answer,
    abandon: () => {
      client.abort();
    },
  };
}
