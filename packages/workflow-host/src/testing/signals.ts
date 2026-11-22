import { Effect } from 'effect';

import { systemClock, type HostClock } from '../loop/host-clock.ts';

interface Waiter {
  readonly check: () => boolean;
}

export interface Signals {
  readonly changed: () => void;
  readonly when: <A>(read: () => A, holds: (value: A) => boolean) => Promise<A>;
}

export function signals(): Signals {
  const waiters = new Set<Waiter>();
  const when = <A>(read: () => A, holds: (value: A) => boolean): Promise<A> => {
    const { promise, resolve } = Promise.withResolvers<A>();
    const waiter: Waiter = {
      check: () => {
        const value = read();
        if (!holds(value)) {
          return false;
        }
        resolve(value);
        return true;
      },
    };
    if (!waiter.check()) {
      waiters.add(waiter);
    }
    return promise;
  };
  return {
    changed: () => {
      for (const waiter of waiters) {
        if (waiter.check()) {
          waiters.delete(waiter);
        }
      }
    },
    when,
  };
}

/**
 * The clock given, or the system's, which says each time a loop of the host goes to sleep: the host has rested
 * from what it was doing, so a test waiting on what the host keeps reads it again then.
 */
export function restingOn(seen: Signals, clock: HostClock = systemClock): HostClock {
  const rested = () => {
    seen.changed();
  };
  return { ...clock, sleep: (milliseconds) => Effect.andThen(Effect.sync(rested), clock.sleep(milliseconds)) };
}
