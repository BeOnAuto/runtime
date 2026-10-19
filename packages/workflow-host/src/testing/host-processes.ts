import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { expect } from 'vitest';

import type { DatabaseSettings } from '../database/host-databases.ts';
import { onPostgreSQLAt } from './host-files.ts';

const hostProcess = fileURLToPath(new URL('../../host-process.ts', import.meta.url));

export type Mode = 'hang-on-call' | 'hang-on-settle' | 'finish';

export type ProcessDatabase =
  | { readonly store: 'sqlite'; readonly file: string }
  | { readonly store: 'postgresql'; readonly connectionString: string };

export type ProcessDatabasesOf = () => Promise<ProcessDatabase>;

export interface HostProcess {
  readonly said: (line: string) => Promise<void>;
  readonly killed: () => Promise<void>;
  readonly paused: (milliseconds: number) => Promise<void>;
  readonly exited: Promise<unknown>;
}

export function databaseSettingsOf(database: ProcessDatabase): DatabaseSettings {
  return database.store === 'sqlite' ? database : onPostgreSQLAt(database.connectionString);
}

export function hostIn(database: ProcessDatabase, mode: Mode, settlements: string, sweepEveryMs = 20): HostProcess {
  const child = spawnForTheTest(
    process.execPath,
    [hostProcess, JSON.stringify(database), mode, settlements, String(sweepEveryMs)],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const output = { said: '' };
  const heard = Promise.withResolvers<void>();
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    output.said += chunk;
    heard.resolve();
  });
  const exited = once(child, 'exit').then(([code]: readonly unknown[]) => code);
  return {
    said: async (line) => {
      await heard.promise;
      expect(output.said).toContain(line);
    },
    killed: async () => {
      child.kill('SIGKILL');
      await exited;
    },
    paused: async (milliseconds) => {
      child.kill('SIGSTOP');
      await setTimeout(milliseconds);
      child.kill('SIGCONT');
    },
    exited,
  };
}

export function linesOf(file: string): readonly unknown[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}
