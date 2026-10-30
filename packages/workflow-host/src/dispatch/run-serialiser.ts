import type { RunSerialiser } from '@on.auto/workflow-engine';
import { Effect, Semaphore } from 'effect';

interface RunLock {
  readonly semaphore: Semaphore.Semaphore;
  readonly release: () => void;
}

export function runSerialiser(): RunSerialiser {
  const locks = new Map<string, { readonly semaphore: Semaphore.Semaphore; holders: number }>();
  const lockOf = (runKey: string): RunLock => {
    const lock = locks.get(runKey) ?? { semaphore: Semaphore.makeUnsafe(1), holders: 0 };
    lock.holders += 1;
    locks.set(runKey, lock);
    return {
      semaphore: lock.semaphore,
      release: () => {
        lock.holders -= 1;
        if (lock.holders === 0) {
          locks.delete(runKey);
        }
      },
    };
  };
  return {
    serialise: (runKey, work) =>
      Effect.suspend(() => {
        const { semaphore, release } = lockOf(runKey);
        return semaphore.withPermit(work).pipe(Effect.ensuring(Effect.sync(release)));
      }),
  };
}
