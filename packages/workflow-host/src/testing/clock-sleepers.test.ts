import { Effect, Fiber, Semaphore } from 'effect';
import { describe, expect, it } from 'vitest';

import { forkedIn } from '../loop/forked-fibers.ts';
import type { HeldWork } from './clock-sleepers.ts';
import { steppedClock, type SteppedClock } from './stepped-clock.ts';

const start = Date.parse('2026-10-06T09:00:00.000Z');

describe('work the test holds, waited for on a stepped clock', () => {
  it('lets the host come to rest while a fiber it forked waits for work the test holds, and not again until it sleeps once let go', async () => {
    const clock = steppedClock(start);
    const work = clock.hold();
    const after = Promise.withResolvers<void>();
    const fiber = forkedIn(
      clock.watching(),
      Effect.andThen(
        work.wait,
        Effect.andThen(
          Effect.promise(() => after.promise),
          Effect.forever(clock.sleep(20)),
        ),
      ),
      'holding',
    );
    await clock.atRest();
    clock.step(Number.MAX_SAFE_INTEGER);
    const whileHeld = clock.asleep();
    work.release();
    const once = clock.asleep();
    after.resolve();

    await clock.atRest();
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect([whileHeld, once, clock.asleep()]).toEqual([1, 0, 0]);
  });

  it('ends at once a wait for work the test let go before it was waited for, and forgets a wait that was interrupted', async () => {
    const clock = steppedClock(start);
    const released = clock.hold();
    released.release();
    await Effect.runPromise(released.wait);
    const waited = Effect.runFork(clock.hold().wait);
    await clock.asleepAtLeast(1);

    await Effect.runPromise(Fiber.interrupt(waited));

    expect(clock.asleep()).toBe(0);
  });
});

interface TakingTurns {
  readonly clock: SteppedClock;
  /** Lets the fiber holding the only permit go, so the queued fiber takes its turn. */
  readonly released: () => void;
  /** Answers once the queued fiber has its turn and works, off the clock. */
  readonly turn: Promise<void>;
  readonly queued: Fiber.Fiber<void>;
  /** Lets the queued fiber end the work it does in its turn. */
  readonly worked: () => void;
}

/** Two fibers of a host on a stepped clock taking turns at one permit: the first holds it on work the test holds. */
function takingTurns(): TakingTurns {
  const clock = steppedClock(start);
  const context = clock.watching();
  const atOnce = Semaphore.makeUnsafe(1);
  const work = clock.hold();
  const turn = Promise.withResolvers<void>();
  const working = Promise.withResolvers<void>();
  forkedIn(context, atOnce.withPermit(work.wait), 'holding');
  const queued = forkedIn(
    context,
    clock.queued((permitted) =>
      atOnce.withPermit(
        Effect.andThen(
          permitted,
          Effect.andThen(
            Effect.sync(turn.resolve),
            Effect.promise(() => working.promise),
          ),
        ),
      ),
    ),
    'queued',
  );
  return {
    clock,
    released: work.release,
    turn: turn.promise,
    queued,
    worked: working.resolve,
  };
}

describe('work waiting its turn on a stepped clock', () => {
  it('lets the host come to rest while a fiber waits for a permit another holds on held work, and names it awake once its turn came', async () => {
    const { clock, released, turn, worked } = takingTurns();
    await clock.atRest();
    const whileQueued = [clock.asleep(), clock.awake()];
    released();
    await turn;
    const inItsTurn = clock.awake();
    worked();

    await clock.atRest();

    expect([whileQueued, inItsTurn, clock.awake()]).toEqual([[2, []], ['queued'], []]);
  });

  it('forgets a fiber interrupted while it waited its turn', async () => {
    const { clock, released, queued } = takingTurns();
    await clock.atRest();
    const whileQueued = clock.asleep();

    await Effect.runPromise(Fiber.interrupt(queued));
    const afterwards = [clock.asleep(), clock.awake()];
    released();
    await clock.atRest();

    expect([whileQueued, afterwards]).toEqual([2, [1, []]]);
  });
});

describe('a permit let go by a turn that ended, on a stepped clock', () => {
  it('keeps the host from rest until the fiber queued behind it takes it, at the next task of the semaphore', async () => {
    const clock = steppedClock(start);
    const context = clock.watching();
    const atOnce = Semaphore.makeUnsafe(1);
    const turns: string[] = [];
    const inTurn = (name: string, work: HeldWork) =>
      forkedIn(
        context,
        clock.queued((permitted) =>
          atOnce.withPermit(
            Effect.andThen(
              permitted,
              Effect.andThen(
                Effect.sync(() => turns.push(name)),
                work.wait,
              ),
            ),
          ),
        ),
        name,
      );
    const first = clock.hold();
    inTurn('first', first);
    inTurn('second', clock.hold());
    await clock.atRest();

    const resting = clock.atRest();
    first.release();
    await resting;

    expect([turns, clock.awake()]).toEqual([['first', 'second'], []]);
  });
});
