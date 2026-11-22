import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';

import type { DatabaseSettings } from '../ledger-testing/ledger-connections.ts';
import { onPostgreSQLAt } from './host-files.ts';
import { signals } from './signals.ts';

const hostProcess = fileURLToPath(new URL('../../host-process.ts', import.meta.url));

export type Mode = 'hang-on-call' | 'hang-on-settle' | 'finish';

export type ProcessDatabase =
  | { readonly store: 'sqlite'; readonly file: string }
  | { readonly store: 'postgresql'; readonly connectionString: string };

export type ProcessDatabasesOf = () => Promise<ProcessDatabase>;

/** The moment the clock of a host in another process starts at, for a host of the test to start its clock at too. */
export const processesStartAt = Date.parse('2026-10-05T09:00:00.000Z');

export interface HostProcess {
  /** Answers once the process has said the line. */
  readonly said: (line: string) => Promise<void>;
  /** Whether the process has said the line by now: after a step, all it said in the step. */
  readonly hasSaid: (line: string) => boolean;
  /** Steps the clock of the process's host from its rest, and answers once that host is at rest again. */
  readonly stepped: (milliseconds: number) => Promise<void>;
  readonly killed: () => Promise<void>;
  /** Closes the standard input of the process, which a host that finishes takes as its cue to stop, and its exit. */
  readonly ended: () => Promise<unknown>;
  readonly exited: Promise<unknown>;
}

interface SteppedUntilSaid {
  readonly everyMs: number;
  readonly atMost: number;
}

export function databaseSettingsOf(database: ProcessDatabase): DatabaseSettings {
  return database.store === 'sqlite' ? database : onPostgreSQLAt(database.connectionString);
}

function acksIn(said: string): number {
  return said.split('\n').filter((line) => line.startsWith('stepped ')).length;
}

export function hostIn(database: ProcessDatabase, mode: Mode, settlements: string, sweepEveryMs = 20): HostProcess {
  const child = spawnForTheTest(
    process.execPath,
    [hostProcess, JSON.stringify(database), mode, settlements, String(sweepEveryMs), String(processesStartAt)],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const output = { said: '', steps: 0 };
  const heard = signals();
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    output.said += chunk;
    heard.changed();
  });
  const exited = once(child, 'exit').then(([code]: readonly unknown[]) => code);
  return {
    said: async (line) => {
      await heard.when(
        () => output.said,
        (said) => said.includes(line),
      );
    },
    hasSaid: (line) => output.said.includes(line),
    stepped: async (milliseconds) => {
      output.steps += 1;
      const expected = output.steps;
      child.stdin?.write(`step ${String(milliseconds)}\n`);
      await heard.when(
        () => acksIn(output.said),
        (acks) => acks >= expected,
      );
    },
    killed: async () => {
      child.kill('SIGKILL');
      await exited;
    },
    ended: () => {
      child.stdin?.end();
      return exited;
    },
    exited,
  };
}

/**
 * Steps the host of the process one sweep at a time, each from its rest, until it has said the line; it steps
 * `atMost` sweeps at most, and then fails saying how far it stepped.
 */
export async function steppedUntilSaid(
  host: HostProcess,
  line: string,
  { everyMs, atMost }: SteppedUntilSaid,
  steps = 0,
): Promise<void> {
  if (host.hasSaid(line)) {
    return;
  }
  if (steps >= atMost) {
    throw new Error(`The process still had not said ${line} after ${String(steps)} sweeps of ${String(everyMs)} ms`);
  }
  await host.stepped(everyMs);
  await steppedUntilSaid(host, line, { everyMs, atMost }, steps + 1);
}

export function linesOf(file: string): readonly unknown[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}
