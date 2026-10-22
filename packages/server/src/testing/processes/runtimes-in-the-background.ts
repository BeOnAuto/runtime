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

function stillTheOneStarted({ pid, instance }: Started): boolean {
  return spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout.includes(instance);
}

export function runtimesStillRunningInTheBackgroundIn(home: string): readonly RunningProcess[] {
  const ended = endedIn(home);
  return startedInTheBackgroundIn(home)
    .filter((started) => !ended.includes(started.pid) && stillTheOneStarted(started))
    .map((started) => ({
      name: `Auto Runtime, process ${started.pid}, instance ${started.instance}`,
      pid: started.pid,
      isStillRunning: () => stillTheOneStarted(started),
    }));
}
