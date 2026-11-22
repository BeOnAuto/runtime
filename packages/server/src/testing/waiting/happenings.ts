import { AsyncLocalStorage } from 'node:async_hooks';

import { sleepOr, type HostClock } from '@on.auto/workflow-host';
import { Effect } from 'effect';

export { heardFrom, heardUntilItExits } from './rest.ts';

const waiting = new Set<() => void>();

const aWaitsRead = new AsyncLocalStorage<true>();

/**
 * Tells every test waiting in the process that something it may be waiting on happened: a server appended, a child
 * process wrote, a file changed, a server slept on the clock its test moves. A wait reads its condition again on each.
 */
export function somethingHappened(): void {
  const woken = [...waiting];
  waiting.clear();
  for (const wake of woken) {
    wake();
  }
}

const told = Effect.sync(somethingHappened);

/**
 * The clock a test hands a server, telling the waiting tests each time the server's loop goes to sleep on it, the work
 * in hand done, and each time a sleep ends, the clock's or a signal's: the test moved the clock or the loop was woken,
 * so what a test waits on may be due.
 */
export function sleepsTold(clock: HostClock): HostClock {
  return {
    ...clock,
    sleep: (milliseconds) =>
      Effect.andThen(
        told,
        Effect.tap(clock.sleep(milliseconds), () => told),
      ),
    sleepOr: (milliseconds, signal) =>
      Effect.andThen(
        told,
        Effect.tap(sleepOr(clock, milliseconds, signal), () => told),
      ),
  };
}

/** The next time something happens in the process, asked for before the condition is read, so none goes unseen. */
export function nextHappening(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  waiting.add(resolve);
  return promise;
}

/** The read of a wait, marked so that what it asks of a server tells no wait, its own included. */
export function readByAWait<A>(read: () => Promise<A>): Promise<A> {
  return aWaitsRead.run(true, read);
}

/** The header a request a wait's read made over a listener carries, as no read's context crosses one. */
export const readByAWaitHeader = 'x-test-read-by-a-wait';

/** Whether the work in hand began in a wait's read: a request a wait made, which changes nothing a wait reads. */
export function inAWaitsRead(): boolean {
  return aWaitsRead.getStore() === true;
}
