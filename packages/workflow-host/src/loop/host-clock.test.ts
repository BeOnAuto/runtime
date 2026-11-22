import { Clock, Context, Effect, Fiber, Function } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { steppedClock, type SteppedClock } from '../testing/stepped-clock.ts';
import { forkedIn } from './forked-fibers.ts';
import { sleepOr, systemClock } from './host-clock.ts';

const start = Date.parse('2026-10-06T09:00:00.000Z');

/** The system's clock, its sleeps answered by `sleep`. */
function theSystemsSleepingBy(sleep: Clock.Clock['sleep']): Clock.Clock {
  const theSystems = Context.get(Context.empty(), Clock.Clock);
  return {
    currentTimeMillisUnsafe: () => theSystems.currentTimeMillisUnsafe(),
    currentTimeMillis: theSystems.currentTimeMillis,
    monotonicTimeNanosUnsafe: () => theSystems.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: theSystems.monotonicTimeNanos,
    currentTimeNanosUnsafe: () => theSystems.currentTimeNanosUnsafe(),
    currentTimeNanos: theSystems.currentTimeNanos,
    sleep,
  };
}

interface SleepsSeen {
  readonly clock: Clock.Clock;
  readonly seen: () => readonly string[];
}

/** Effect's clock, each sleep it is asked for said, never ending of itself, its interruption said. */
function sleepsSeen(): SleepsSeen {
  const seen: string[] = [];
  return {
    clock: theSystemsSleepingBy(() =>
      Effect.callback<void>(() => {
        seen.push('asleep');
        return Effect.sync(() => {
          seen.push('interrupted');
        });
      }),
    ),
    seen: () => [...seen],
  };
}

type SleepingOr = (milliseconds: number, signal: Effect.Effect<void>) => Effect.Effect<void>;

const sleepsOrOnTheSystemsClock: readonly (readonly [string, SleepingOr])[] = [
  ['the race the loop of a host ran before', (ms, signal) => Effect.raceFirst(systemClock.sleep(ms), signal)],
  ['the race the due work ran before', (ms, signal) => Effect.raceFirst(signal, systemClock.sleep(ms))],
  ['sleepOr', (ms, signal) => sleepOr(systemClock, ms, signal)],
];

const signalFirst = sleepsOrOnTheSystemsClock.slice(1);

describe("a sleep that a signal can end, on the system's clock", () => {
  it.each(sleepsOrOnTheSystemsClock)(
    "ends as the time it asked for passes on Effect's clock, when no signal comes: %s",
    async (_how, sleepingOr) => {
      const endedAt = await Effect.runPromise(
        Effect.gen(function* () {
          const sleeping = yield* Effect.forkChild(
            Effect.andThen(sleepingOr(1000, Effect.never), Clock.currentTimeMillis),
          );
          yield* TestClock.adjust(999);
          yield* TestClock.adjust(1);
          return yield* Fiber.join(sleeping);
        }).pipe(Effect.provide(TestClock.layer())),
      );

      expect(endedAt).toBe(1000);
    },
  );

  it.each(sleepsOrOnTheSystemsClock)(
    'ends as the signal ends, interrupting its sleep: %s',
    async (_how, sleepingOr) => {
      const sleeps = sleepsSeen();
      const signal = Promise.withResolvers<void>();
      const sleeping = Effect.runPromise(
        Effect.provideService(
          sleepingOr(
            1000,
            Effect.promise(() => signal.promise),
          ),
          Clock.Clock,
          sleeps.clock,
        ),
      );
      signal.resolve();
      await sleeping;

      expect(sleeps.seen()).toEqual(['asleep', 'interrupted']);
    },
  );

  it.each(signalFirst)('starts no sleep for a signal that has already ended: %s', async (_how, sleepingOr) => {
    const sleeps = sleepsSeen();

    await Effect.runPromise(Effect.provideService(sleepingOr(1000, Effect.void), Clock.Clock, sleeps.clock));

    expect(sleeps.seen()).toEqual([]);
  });
});

describe('a sleep that a signal can end, on a stepped clock', () => {
  it('ends at the step that reaches its time when no signal comes, and not before', async () => {
    const clock = steppedClock(start);
    const sleeping = Effect.runPromise(sleepOr(clock, 1000, Effect.never));
    await clock.asleepAtLeast(1);
    clock.step(999);
    const early = clock.asleep();
    clock.step(1);
    await sleeping;

    expect([early, clock.asleep(), clock.now()]).toEqual([1, 0, start + 1000]);
  });

  it('leaves the clock in the same turn as the signal ends, before a test told of the signal reads the clock', async () => {
    const clock = steppedClock(start);
    const signal = Promise.withResolvers<void>();
    const sleeping = Effect.runPromise(
      sleepOr(
        clock,
        1000,
        Effect.promise(() => signal.promise),
      ),
    );
    await clock.asleepAtLeast(1);
    signal.resolve();
    await signal.promise;
    const left = clock.asleep();
    await sleeping;

    expect([left, clock.now()]).toEqual([0, start]);
  });
});

describe('a sleep that a signal ended, on a stepped clock', () => {
  it('holds no sleep of its own once it goes on, from a signal that had ended before it slept', async () => {
    const clock = steppedClock(start);

    const left = await Effect.runPromise(Effect.andThen(sleepOr(clock, 1000, Effect.void), Effect.sync(clock.asleep)));

    expect([left, clock.now()]).toEqual([0, start]);
  });

  it('holds no sleep of its own once it goes on, from a signal that ended as the clock stepped', async () => {
    const clock = steppedClock(start);
    const performing = Effect.runFork(clock.sleep(50));
    const going = Effect.runPromise(
      Effect.andThen(sleepOr(clock, 1000, Fiber.await(performing)), Effect.sync(clock.asleep)),
    );
    await clock.asleepAtLeast(2);
    clock.step(50);

    expect([await going, clock.now()]).toEqual([0, start + 50]);
  });

  it('is never counted asleep, not for a moment, when its signal had ended before it slept', async () => {
    const clock = steppedClock(start);
    const counted: number[] = [];
    void clock.when(
      () => counted.push(clock.asleep()),
      () => false,
    );

    await Effect.runPromise(sleepOr(clock, 1000, Effect.void));

    expect(Math.max(0, ...counted)).toBe(0);
  });

  it('ends at once for a sleep of nothing, as a sleep of nothing does', async () => {
    const clock = steppedClock(start);

    await Effect.runPromise(sleepOr(clock, 0, Effect.never));

    expect(clock.asleep()).toBe(0);
  });
});

/** A promise that settles as the one `ended` gives does, passed on through as many, each a microtask after the last. */
function passedOn(ended: () => Promise<void>, times: number): Promise<void> {
  return times <= 1 ? ended() : passedOn(() => ended().then(Function.constVoid), times - 1);
}

interface BatchEnding {
  /** The fiber performing the batch, awaited. */
  readonly performed: Effect.Effect<void>;
  /** The promise the batch resolves as it ends, waking the loop. */
  readonly ended: () => Promise<void>;
}

const batchEndings: readonly (readonly [string, (ending: BatchEnding) => Effect.Effect<void>])[] = [
  ['the fiber performing it, as the due work awaits it', ({ performed }) => performed],
  ['a promise it resolves as it ends, as the loop is woken', ({ ended }) => Effect.promise(ended)],
  ['that promise passed on a hundred times', ({ ended }) => Effect.promise(() => passedOn(ended, 100))],
];

describe('a host waiting on the batch it handed out, on a stepped clock', () => {
  it.each(batchEndings)(
    'lets a host whose batch ended come to rest only once the next batch and its wait for it are asleep, told by %s',
    async (_how, endedBy) => {
      const clock = steppedClock(start);
      const context = clock.watching();
      const handedOut = { batches: 0 };
      const batch = Effect.suspend(() => {
        const ended = Promise.withResolvers<void>();
        const performing = forkedIn(context, Effect.ensuring(clock.sleep(50), Effect.sync(ended.resolve)), 'batch');
        return Effect.andThen(
          sleepOr(
            clock,
            1000,
            endedBy({ performed: Effect.asVoid(Fiber.await(performing)), ended: () => ended.promise }),
          ),
          Effect.sync(() => {
            handedOut.batches += 1;
          }),
        );
      });
      const handing = forkedIn(context, Effect.forever(batch), 'handing');
      await clock.atRest();
      clock.step(50);

      await clock.atRest();
      const rested = [handedOut.batches, clock.asleep()];
      await Effect.runPromise(Fiber.interrupt(handing));

      expect(rested).toEqual([1, 2]);
    },
  );
});

/**
 * A loop that, at each move of the clock to its next second, starts an item whose work is off the clock and waits
 * for it beside a wait for nothing handed out, as two due works of a host do.
 */
function itemsStartedAtEachSecond(clock: SteppedClock, work: Effect.Effect<void>): Fiber.Fiber<never> {
  const context = clock.watching();
  const started = Effect.suspend(() => {
    const item = forkedIn(context, work, 'item');
    return Effect.forEach([Effect.asVoid(Fiber.await(item)), Effect.void], (awaited) => sleepOr(clock, 1000, awaited), {
      concurrency: 'unbounded',
    });
  });
  return forkedIn(context, Effect.forever(Effect.andThen(clock.sleep(1000), started)), 'loop');
}

describe('a due item started at a move of a stepped clock', () => {
  it('keeps its host from rest while it works off the clock, though another wait of the loop awaits nothing', async () => {
    const clock = steppedClock(start);
    const item = { ended: false };
    const offTheClock = Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          setImmediate(resolve);
        }),
    );
    const loop = itemsStartedAtEachSecond(
      clock,
      Effect.andThen(
        offTheClock,
        Effect.sync(() => {
          item.ended = true;
        }),
      ),
    );
    await clock.atRest();
    clock.step(1000);

    await clock.atRest();
    const rested = [item.ended, clock.asleep()];
    await Effect.runPromise(Fiber.interrupt(loop));

    expect(rested).toEqual([true, 1]);
  });
});
