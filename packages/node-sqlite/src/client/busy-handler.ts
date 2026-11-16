import { setTimeout as sleep } from 'node:timers/promises';

import { isBusy } from './result-codes.ts';

const delaysOfSQLitesBusyHandler: readonly number[] = [1, 2, 5, 10, 15, 20, 25, 25, 25, 50, 50, 100];

const longestDelay = 100;

function delayAt(attempt: number): number {
  return delaysOfSQLitesBusyHandler[attempt] ?? longestDelay;
}

function waitedBefore(attempt: number): number {
  return Array.from({ length: attempt }, (_, earlier) => delayAt(earlier)).reduce((sum, delay) => sum + delay, 0);
}

export function busyDelay(attempt: number, busyTimeout: number): number {
  return Math.min(delayAt(attempt), busyTimeout - waitedBefore(attempt));
}

export interface LockWait {
  readonly busyTimeout: number;
  readonly inATransaction: () => boolean;
}

export async function waitedForTheLock<A>(attempt: () => Promise<A>, wait: LockWait, attempted = 0): Promise<A> {
  try {
    return await attempt();
  } catch (error: unknown) {
    const delay = busyDelay(attempted, wait.busyTimeout);
    if (!isBusy(error) || wait.inATransaction() || delay <= 0) {
      throw error;
    }
    await sleep(delay);
    return waitedForTheLock(attempt, wait, attempted + 1);
  }
}
