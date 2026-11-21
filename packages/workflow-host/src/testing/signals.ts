import { Effect } from 'effect';

import { systemClock, type HostClock } from '../loop/host-clock.ts';

interface Waiter {
  readonly check: () => boolean;
}

/** As `when`, for a read that answers later, such as a read of the database: it reads again after each change. */
interface WhenRead {
  <A, B extends A>(read: () => A | Promise<A>, holds: (value: A) => value is B): Promise<B>;
  <A>(read: () => A | Promise<A>, holds: (value: A) => boolean): Promise<A>;
}

export interface Signals {
  readonly changed: () => void;
  readonly when: <A>(read: () => A, holds: (value: A) => boolean) => Promise<A>;
  readonly whenRead: WhenRead;
}

export function signals(): Signals {
  const waiters = new Set<Waiter>();
  const changes = { next: Promise.withResolvers<void>() };
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
  function whenRead<A, B extends A>(read: () => A | Promise<A>, holds: (value: A) => value is B): Promise<B>;
  function whenRead<A>(read: () => A | Promise<A>, holds: (value: A) => boolean): Promise<A>;
  async function whenRead<A>(read: () => A | Promise<A>, holds: (value: A) => boolean): Promise<A> {
    const changedMeanwhile = changes.next.promise;
    const value = await read();
    if (holds(value)) {
      return value;
    }
    await changedMeanwhile;
    return whenRead(read, holds);
  }
  return {
    changed: () => {
      const { resolve } = changes.next;
      changes.next = Promise.withResolvers<void>();
      resolve();
      for (const waiter of waiters) {
        if (waiter.check()) {
          waiters.delete(waiter);
        }
      }
    },
    when,
    whenRead,
  };
}

/**
 * The clock given, or the system's, which says each time a loop of the host goes to sleep: the host has rested
 * from what it was doing, so a test waiting on what the host keeps reads it again then.
 */
export function restingOn(seen: Signals, clock: HostClock = systemClock): HostClock {
  const rested = () => {
    seen.changed();
    restsOfTheHosts.changed();
  };
  return { ...clock, sleep: (milliseconds) => Effect.andThen(Effect.sync(rested), clock.sleep(milliseconds)) };
}

/**
 * Each rest of any host of the test file, for a helper that is handed only a host's database: what it reads there is
 * read again each time one of the file's hosts rests.
 */
export const restsOfTheHosts: Signals = signals();
