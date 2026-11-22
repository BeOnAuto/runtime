import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

import { onTestFinished } from 'vitest';

import { endedWithin, lookedForUntilGone, realPidEnding, type Ending, type PidEnding } from './process-endings.ts';

export interface TestProcessOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdio?: readonly ('ignore' | 'inherit' | 'ipc' | 'pipe')[];
  readonly detached?: boolean;
  readonly serialization?: 'advanced' | 'json';
  readonly timeout?: number;
}

/** Where the end of a process is registered, and how a process is ended there. */
export interface TestFinish extends PidEnding {
  readonly registered: (end: () => Promise<void>) => void;
}

export interface PidReader {
  readonly read: () => Promise<number | undefined>;
  readonly stillToCome: () => boolean;
  readonly readWithinMs: number;
}

const theTestsFinish: TestFinish = {
  ...realPidEnding,
  registered: (end) => {
    onTestFinished(end);
  },
};

function endingOfPid(pid: number, { signaller, timer, lookEveryMs }: TestFinish): Ending {
  const isGone = () => !signaller(pid, 0);
  return {
    isGone,
    signal: (name) => signaller(pid, name),
    gone: (stop) => lookedForUntilGone(isGone, stop, timer, lookEveryMs),
  };
}

/** Reads the pid every `lookEveryMs` while one is still to come, for at most the reader's `readWithinMs`. */
async function pidRead(reader: PidReader, finish: TestFinish, waitedMs = 0): Promise<number | undefined> {
  const pid = await reader.read();
  if (pid !== undefined || !reader.stillToCome() || waitedMs >= reader.readWithinMs) {
    return pid;
  }
  await finish.timer.after(finish.lookEveryMs, new AbortController().signal);
  return pidRead(reader, finish, waitedMs + finish.lookEveryMs);
}

function pidOf(pidOrReader: number | PidReader, finish: TestFinish): Promise<number | undefined> {
  return typeof pidOrReader === 'number' ? Promise.resolve(pidOrReader) : pidRead(pidOrReader, finish);
}

export function endWithTheTest(pidOrReader: number | PidReader, finish: TestFinish = theTestsFinish): void {
  finish.registered(async () => {
    const pid = await pidOf(pidOrReader, finish);
    if (pid !== undefined) {
      await endedWithin(endingOfPid(pid, finish), finish.stoppedWithinMs, finish.timer);
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

/** What an ending reads of a child the test started. */
interface Child {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly kill: (signal: NodeJS.Signals) => boolean;
  readonly once: (event: 'exit', listener: () => void) => unknown;
}

/** The ending of a child the test started, which is gone on its own `exit`, or at once if it never started. */
export function endingOfChild(child: Child): Ending {
  const isGone = () => child.pid === undefined || child.exitCode !== null || child.signalCode !== null;
  const { promise: exited, resolve } = Promise.withResolvers<void>();
  child.once('exit', () => {
    resolve();
  });
  return { isGone, signal: (name) => child.kill(name), gone: () => (isGone() ? Promise.resolve() : exited) };
}

export function spawnForTheTest(
  command: string,
  args: readonly string[],
  options: TestProcessOptions = {},
  finish: TestFinish = theTestsFinish,
): ChildProcess {
  const child = spawn(command, [...args], spawnOptionsOf(options));
  const ending = endingOfChild(child);
  finish.registered(() => endedWithin(ending, finish.stoppedWithinMs, finish.timer));
  return child;
}
