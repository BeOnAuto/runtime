import {
  fewSweeps,
  steppedBy,
  steppedMovedClock,
  type SteppedMovedClock,
  type SteppedSweeps,
} from '@on.auto/workflow-host/testing';
import { Clock, Effect } from 'effect';
import { TestRunner } from 'vitest';

import { workInHand, type WorkInHand } from './work-in-hand.ts';

export { statementsInHand } from './work-in-hand.ts';

export { fewSweeps };

/** How many sweeps a wait may step at most. */
export type SweepsAtMost = typeof fewSweeps;

/**
 * The moment every test server's stepped clock starts at unless its test names another: a fixed date, so that nothing a
 * test asserts rests on the day it runs.
 */
export const testServersStartAt = Date.parse('2026-01-05T09:00:00.000Z');

const nanosPerMilli = BigInt(1_000_000);

/**
 * Effect's Clock for a server on a stepped clock: the time it reads is the host's, so what the server stamps from
 * Effect's Clock and what its host compares it with agree; its sleeps stay the system's, as the server's own are.
 */
export function effectClockOn(now: () => number): Clock.Clock {
  const nanos = () => BigInt(now()) * nanosPerMilli;
  const system = Clock.Clock.defaultValue();
  return {
    currentTimeMillisUnsafe: now,
    currentTimeMillis: Effect.sync(now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: system.monotonicTimeNanosUnsafe.bind(system),
    monotonicTimeNanos: system.monotonicTimeNanos,
    sleep: system.sleep.bind(system),
  };
}

/** The sweep of a server's workflows, as WORKFLOW_SWEEP_INTERVAL ships. */
const sweepOfAServerMs = 1000;

export interface SteppedServerClock extends SteppedMovedClock {
  /** The work the server has in hand that its host's fibers do not count: no sweep is stepped while any is. */
  readonly inHand: WorkInHand;
  /** Steps the server's sweeps, one at a time and only while its host is wholly at rest, until a read holds. */
  readonly swept: SteppedSweeps;
  /** Steps the time by the given step, as `swept` steps sweeps, for what falls due at a longer interval. */
  readonly steppedEvery: (everyMs: number) => SteppedSweeps;
}

/**
 * TIME MOVES ONLY WHEN THE TEST MOVES IT, IN STEPS THE TEST NAMES.
 *
 * The clock a test hands a server: its host sleeps on it, and wakes only when the test moves the time to a moment or
 * steps the sweeps it names. The server gives its host the clock's watch, so `atRest` and `swept` know when every
 * fiber the host forked sleeps.
 */
export function steppedServerClock(start = testServersStartAt, sweepEveryMs = sweepOfAServerMs): SteppedServerClock {
  const moved = steppedMovedClock(start);
  const inHand = workInHand();
  const steppable = { ...moved, atRest: () => restedWithNothingInHand(moved, inHand) };
  const steppedEvery = (everyMs: number) => namingTheAwake(moved, steppedBy(steppable, everyMs));
  return {
    ...moved,
    inHand,
    swept: steppedEvery(sweepEveryMs),
    steppedEvery,
  };
}

/**
 * Answers once the host is wholly at rest with nothing in hand, so that no time is stepped while a request or a
 * statement of the ledger is still on its way: what it does next may wake the host.
 */
async function restedWithNothingInHand(clock: Pick<SteppedMovedClock, 'atRest'>, inHand: WorkInHand): Promise<void> {
  await clock.atRest();
  if (inHand.busy()) {
    await inHand.done();
    await restedWithNothingInHand(clock, inHand);
  }
}

/**
 * The failure added to a test that failed, its timeout among the causes, while one of its waits for the server's host
 * to rest still waited: the labels of the fibers of the host still awake then, none when the host had come to rest and
 * the wait was on its read.
 */
class StillAwake extends Error {
  readonly awake: readonly string[];

  constructor(awake: readonly string[]) {
    super(
      `A wait for the server's host to rest was still waiting as the test failed; still awake: ${awake.join(', ')}`,
    );
    this.name = 'StillAwake';
    this.awake = awake;
  }
}

/** Says, as the test fails, what to add to its failure. */
type WhenTheTestFails = (named: () => void) => void;

/** Adds to the failure of the test running now, if it fails; a wait in a hook outside a test has no test to add to. */
function whenTheCurrentTestFails(named: () => void): void {
  TestRunner.getCurrentTest()?.context.onTestFailed(named);
}

/**
 * Sweeps whose waits, while one of them still waits as the test fails, name the fibers of the host still awake. A wait
 * holds no timer of its own: a fiber waiting on I/O looks to the clock as one parked for good does, so only the test's
 * own end says the host never came to rest.
 */
export function namingTheAwake(
  clock: Pick<SteppedMovedClock, 'awake'>,
  sweeps: SteppedSweeps,
  whenTheTestFails: WhenTheTestFails = whenTheCurrentTestFails,
): SteppedSweeps {
  const named = <A>(wait: () => Promise<A>): Promise<A> => {
    const waiting = { now: true };
    whenTheTestFails(() => {
      if (waiting.now) {
        throw new StillAwake(clock.awake());
      }
    });
    return wait().finally(() => {
      waiting.now = false;
    });
  };
  return {
    until: <A>(read: () => A | Promise<A>, holds: (value: A) => boolean, bound: SweepsAtMost) =>
      named(() => sweeps.until(read, holds, bound)),
    rested: () => named(sweeps.rested),
  };
}

/** A test server, with the stepped clock it runs on unless its test gave it another clock or the system's. */
interface Stepped {
  readonly clock?: SteppedServerClock | undefined;
}

/** The stepped clock of the server's own, or a failure saying it has none for its test to step. */
export function ownClockOf(server: Stepped): SteppedServerClock {
  const { clock } = server;
  if (clock === undefined) {
    throw new Error('The server has no stepped clock of its own: step the clock its test gave it');
  }
  return clock;
}

/**
 * The read once it holds, the server's sweeps on its own stepped clock stepped one at a time, a few at most unless the
 * test names more, while the server is wholly at rest and the read does not hold. A server given another clock, or the
 * system's, has none of its own to step, and the wait says so.
 */
export function whenSwept<A>(
  server: Stepped,
  read: () => A | Promise<A>,
  holds: (value: A) => boolean,
  bound: SweepsAtMost = fewSweeps,
): Promise<A> {
  return Promise.try(() => ownClockOf(server).swept.until(read, holds, bound));
}

/**
 * The answer of a fake that never comes, held on the server's stepped clock rather than `Effect.never`: the host counts
 * the fiber waiting on it asleep, so it can come to rest, and a wait that hears from it can say nothing more will happen.
 */
export function heldAnswerOn(clock: SteppedServerClock): Effect.Effect<never> {
  return Effect.suspend(() => Effect.andThen(clock.hold().wait, Effect.never));
}
