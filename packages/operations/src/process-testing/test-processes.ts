import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

import { onTestFinished } from 'vitest';

import { endedWithin, lookEveryMs, signalled, stoppedWithinMs, type Ending } from './process-endings.ts';

export interface TestProcessOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdio?: readonly ('ignore' | 'inherit' | 'ipc' | 'pipe')[];
  readonly detached?: boolean;
  readonly serialization?: 'advanced' | 'json';
  readonly timeout?: number;
}

export interface TestFinish {
  readonly registered: (end: () => Promise<void>) => void;
  readonly stoppedWithinMs: number;
}

export interface PidReader {
  readonly read: () => Promise<number | undefined>;
  readonly stillToCome: () => boolean;
  readonly readWithinMs: number;
}

const theTestsFinish: TestFinish = {
  registered: (end) => {
    onTestFinished(end);
  },
  stoppedWithinMs,
};

function endingOfPid(pid: number): Ending {
  return { isGone: () => !signalled(pid, 0), signal: (name) => signalled(pid, name) };
}

async function pidReadBy(reader: PidReader, deadline: number): Promise<number | undefined> {
  const pid = await reader.read();
  if (pid !== undefined || !reader.stillToCome() || performance.now() >= deadline) {
    return pid;
  }
  await setTimeout(lookEveryMs);
  return pidReadBy(reader, deadline);
}

function pidOf(pidOrReader: number | PidReader): Promise<number | undefined> {
  return typeof pidOrReader === 'number'
    ? Promise.resolve(pidOrReader)
    : pidReadBy(pidOrReader, performance.now() + pidOrReader.readWithinMs);
}

export function endWithTheTest(pidOrReader: number | PidReader, finish: TestFinish = theTestsFinish): void {
  finish.registered(async () => {
    const pid = await pidOf(pidOrReader);
    if (pid !== undefined) {
      await endedWithin(endingOfPid(pid), finish.stoppedWithinMs);
    }
  });
}

function spawnOptionsOf({ env, stdio, ...rest }: TestProcessOptions): SpawnOptions {
  return {
    ...rest,
    ...(env === undefined ? {} : { env: { ...env } }),
    ...(stdio === undefined ? {} : { stdio: [...stdio] }),
  };
}

export function spawnForTheTest(
  command: string,
  args: readonly string[],
  options: TestProcessOptions = {},
  finish: TestFinish = theTestsFinish,
): ChildProcess {
  const child = spawn(command, [...args], spawnOptionsOf(options));
  const ending: Ending = {
    isGone: () => child.pid === undefined || child.exitCode !== null || child.signalCode !== null,
    signal: (name) => child.kill(name),
  };
  finish.registered(() => endedWithin(ending, finish.stoppedWithinMs));
  return child;
}
