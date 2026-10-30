import { setTimeout } from 'node:timers/promises';

export interface Ending {
  readonly isGone: () => boolean;
  readonly signal: (name: NodeJS.Signals) => unknown;
}

export interface RunningProcess {
  readonly name: string;
  readonly pid: number;
  readonly isStillRunning: () => boolean;
}

export const stoppedWithinMs = 10_000;

export const lookEveryMs = 50;

export function signalled(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function goneBy(ending: Ending, deadline: number): Promise<boolean> {
  if (ending.isGone() || performance.now() >= deadline) {
    return ending.isGone();
  }
  await setTimeout(lookEveryMs);
  return goneBy(ending, deadline);
}

export async function endedWithin(ending: Ending, withinMs: number): Promise<void> {
  if (ending.isGone()) {
    return;
  }
  ending.signal('SIGTERM');
  if (!(await goneBy(ending, performance.now() + withinMs))) {
    ending.signal('SIGKILL');
    await goneBy(ending, Number.POSITIVE_INFINITY);
  }
}

export function endedWhileItRuns({ pid, isStillRunning }: RunningProcess): Promise<void> {
  return endedWithin({ isGone: () => !isStillRunning(), signal: (name) => signalled(pid, name) }, stoppedWithinMs);
}
