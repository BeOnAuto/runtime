import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

import { stoppedWithinMs } from '@on.auto/operations/testing';
import { onTestFinished } from 'vitest';

import { logFileIn } from '../../local-runtime/local-control.ts';
import { until } from '../waiting/until.ts';

export interface StartedInTheBackground {
  readonly pid: () => Promise<number>;
}

function logIn(home: string): string {
  try {
    return readFileSync(logFileIn(home), 'utf8');
  } catch {
    return '';
  }
}

interface Started {
  readonly pid: number;
  readonly instance: string;
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

const lookEveryMs = 50;

function stillTheOneStarted({ pid, instance }: Started): boolean {
  return spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout.includes(instance);
}

function signalledWhileItRuns(started: Started, signal: NodeJS.Signals): void {
  if (stillTheOneStarted(started)) {
    process.kill(started.pid, signal);
  }
}

async function goneBy(started: Started, deadline: number): Promise<void> {
  if (!stillTheOneStarted(started) || performance.now() >= deadline) {
    return;
  }
  await setTimeout(lookEveryMs);
  await goneBy(started, deadline);
}

async function endedWhileItRuns(started: Started): Promise<void> {
  signalledWhileItRuns(started, 'SIGTERM');
  await goneBy(started, performance.now() + stoppedWithinMs);
  signalledWhileItRuns(started, 'SIGKILL');
  await goneBy(started, performance.now() + stoppedWithinMs);
}

export function runtimesStartedInTheBackgroundEndedWithTheTest(home: string): StartedInTheBackground {
  onTestFinished(async () => {
    const ended = endedIn(home);
    const living = startedInTheBackgroundIn(home).filter(({ pid }) => !ended.includes(pid));
    await Promise.all(living.map((started) => endedWhileItRuns(started)));
  });
  const read = { starts: 0 };
  return {
    pid: async () => {
      const started = await until(
        () => startedInTheBackgroundIn(home),
        (starts) => starts.length > read.starts,
      );
      read.starts = started.length;
      return Number(started.map(({ pid }) => pid).at(-1));
    },
  };
}
