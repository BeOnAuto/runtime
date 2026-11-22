import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import type { RunningProcess } from '@on.auto/operations/testing';

import { logFileIn } from '../../local-runtime/local-control.ts';

interface Started {
  readonly pid: number;
  readonly instance: string;
}

function logIn(home: string): string {
  try {
    return readFileSync(logFileIn(home), 'utf8');
  } catch {
    return '';
  }
}

export function startedInTheBackgroundIn(home: string): readonly Started[] {
  return [
    ...logIn(home).matchAll(/Auto Runtime was started in the background as process (\d+), instance ([\da-f-]+)/gu),
  ].map(([, pid, instance]: readonly string[]) => ({ pid: Number(pid), instance: String(instance) }));
}

function endedIn(home: string): readonly number[] {
  return [...logIn(home).matchAll(/Auto Runtime, process (\d+), ended/gu)].map(([, pid]: readonly string[]) =>
    Number(pid),
  );
}

function isThere(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The command lines of the pids, from one `ps` for them all. */
function commandLinesOf(pids: readonly number[]): string {
  return pids.length === 0
    ? ''
    : spawnSync('ps', ['-o', 'command=', '-p', pids.join(',')], { encoding: 'utf8' }).stdout;
}

/**
 * The runtimes the log names as started and not as ended that still run as the instance they were started as, asked of
 * one `ps`; each is then still running while its pid is there, which signal 0 asks without starting a process.
 */
export function runtimesStillRunningInTheBackgroundIn(home: string): readonly RunningProcess[] {
  const ended = endedIn(home);
  const left = startedInTheBackgroundIn(home).filter(({ pid }) => !ended.includes(pid));
  const commandLines = commandLinesOf(left.map(({ pid }) => pid));
  return left
    .filter(({ instance }) => commandLines.includes(instance))
    .map((started) => ({
      name: `Auto Runtime, process ${started.pid}, instance ${started.instance}`,
      pid: started.pid,
      isStillRunning: () => isThere(started.pid),
    }));
}
