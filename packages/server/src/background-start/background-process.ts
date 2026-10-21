import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, mkdirSync, openSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Environment } from '@on.auto/config';

import { logFileIn, runtimeHomeIn } from '../local-runtime/local-control.ts';
import { startWaitMs } from '../local-runtime/runtime-restarts.ts';
import type { StartingLock } from './background-start.ts';
import type { StartedRuntime } from './started-runtimes.ts';

export interface BackgroundCommand {
  readonly execPath: string;
  readonly execArgv: readonly string[];
  readonly entry: string;
  readonly home: string;
  readonly environment: Environment;
  readonly report: (line: string) => void;
  readonly log: (line: string) => void;
}

const backgroundStart: readonly string[] = ['start', '--background', '--instance'];

const instancePattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;

function backgroundArgumentsFor(instance: string): readonly string[] {
  return [...backgroundStart, instance];
}

export function instanceStartedInBackground(args: readonly string[]): string | undefined {
  const asked = args.slice(0, backgroundStart.length).join(' ') === backgroundStart.join(' ');
  const given = args.slice(backgroundStart.length);
  return asked && given.length === 1 && given.every((instance) => instancePattern.test(instance))
    ? given.join('')
    : undefined;
}

function spawnedFor(command: BackgroundCommand, instance: string): ChildProcess {
  const runtimeHome = runtimeHomeIn(command.home);
  mkdirSync(runtimeHome, { recursive: true });
  const log = openSync(logFileIn(command.home), 'a');
  try {
    return spawn(command.execPath, [...command.execArgv, command.entry, ...backgroundArgumentsFor(instance)], {
      cwd: runtimeHome,
      detached: true,
      stdio: ['ignore', log, log],
      env: { ...command.environment },
    });
  } finally {
    closeSync(log);
  }
}

export function startInBackgroundOf(command: BackgroundCommand): () => StartedRuntime {
  return () => {
    const instance = randomUUID();
    const startedAt = Date.now();
    const child = spawnedFor(command, instance);
    const ending = Promise.withResolvers<void>();
    const times: { endedAt: number | undefined } = { endedAt: undefined };
    const ended = () => {
      times.endedAt = Date.now();
      ending.resolve();
    };
    child
      .on('error', (error: Readonly<Error>) => {
        command.report(`Auto Runtime could not be started: ${error.message}`);
        ended();
      })
      .on('exit', () => {
        command.log(`Auto Runtime, process ${String(child.pid)}, ended`);
        ended();
      })
      .unref();
    if (child.pid !== undefined) {
      command.log(`Auto Runtime was started in the background as process ${child.pid}, instance ${instance}`);
    }
    return {
      instance,
      pid: child.pid,
      startedAt,
      endedAt: () => times.endedAt,
      signal: (name) => child.kill(name),
      ended: ending.promise,
    };
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

export function loggedTo(home: string, report: (line: string) => void): (line: string) => void {
  return (line) => {
    report(line);
    if (!written(logFileIn(home), line)) {
      report(`Auto Runtime could not write to ${logFileIn(home)}`);
    }
  };
}

export function noticesFor(home: string, report: (line: string) => void): (line: string) => void {
  const told = new Set<string>();
  const logged = loggedTo(home, report);
  return (line) => {
    if (told.has(line)) {
      return;
    }
    told.add(line);
    logged(line);
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
