import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, mkdirSync, openSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Environment } from '@on.auto/config';

import { logFileIn, runtimeHomeIn } from '../local-runtime/local-control.ts';
import { startWaitMs } from '../local-runtime/runtime-restarts.ts';
import type { StartingLock } from './background-start.ts';

export interface BackgroundCommand {
  readonly execPath: string;
  readonly execArgv: readonly string[];
  readonly entry: string;
  readonly home: string;
  readonly environment: Environment;
  readonly report: (line: string) => void;
}

export const backgroundArguments: readonly string[] = ['start', '--background'];

export function startInBackgroundOf(command: BackgroundCommand): () => void {
  return () => {
    const runtimeHome = runtimeHomeIn(command.home);
    mkdirSync(runtimeHome, { recursive: true });
    const log = openSync(logFileIn(command.home), 'a');
    try {
      spawn(command.execPath, [...command.execArgv, command.entry, ...backgroundArguments], {
        cwd: runtimeHome,
        detached: true,
        stdio: ['ignore', log, log],
        env: { ...command.environment },
      })
        .on('error', (error: Readonly<Error>) => {
          command.report(`Auto Runtime could not be started: ${error.message}`);
        })
        .unref();
    } finally {
      closeSync(log);
    }
  };
}

function written(file: string, line: string): boolean {
  try {
    appendFileSync(file, `${line}\n`);
    return true;
  } catch {
    return false;
  }
}

export function noticesFor(home: string, report: (line: string) => void): (line: string) => void {
  const told = new Set<string>();
  return (line) => {
    if (told.has(line)) {
      return;
    }
    told.add(line);
    report(line);
    if (!written(logFileIn(home), line)) {
      report(`Auto Runtime could not write to ${logFileIn(home)}`);
    }
  };
}

const staleLockMs = 2 * startWaitMs;

function created(file: string): boolean {
  try {
    closeSync(openSync(file, 'wx'));
    return true;
  } catch {
    return false;
  }
}

function renamed(file: string, to: string): boolean {
  try {
    renameSync(file, to);
    return true;
  } catch {
    return false;
  }
}

function isStale(file: string, now: () => number): boolean {
  const since = statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? now();
  return now() - since > staleLockMs;
}

function takenOver(file: string, now: () => number): boolean {
  const own = `${file}.${randomUUID()}`;
  if (!renamed(file, own)) {
    return false;
  }
  if (isStale(own, now)) {
    rmSync(own);
    return created(file);
  }
  renameSync(own, file);
  return false;
}

export function startingLockIn(home: string, now: () => number = Date.now): StartingLock {
  const file = join(runtimeHomeIn(home), 'starting.lock');
  return {
    take: () => {
      mkdirSync(runtimeHomeIn(home), { recursive: true });
      return created(file) || (isStale(file, now) && takenOver(file, now));
    },
    release: () => {
      rmSync(file, { force: true });
    },
  };
}
