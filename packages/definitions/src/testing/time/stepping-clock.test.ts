import { Clock, Duration, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { onTheStandingClock, standingRenderClock, steppingClock } from './stepping-clock.ts';

describe('a stepping clock', () => {
  it('moves its monotonic time by its step each time it is read, from nothing', async () => {
    const clock = steppingClock(5);

    const reads = [clock.monotonicTimeNanosUnsafe(), await Effect.runPromise(clock.monotonicTimeNanos)];

    expect(reads).toEqual([0n, 5_000_000n]);
  });

  it('stands still with a step of nothing', () => {
    const clock = steppingClock(0);

    expect([clock.monotonicTimeNanosUnsafe(), clock.monotonicTimeNanosUnsafe()]).toEqual([0n, 0n]);
  });

  it('stands still as the clock of an effect run on the standing clock, and as the standing clock of a render', () => {
    const reads = Effect.runSync(
      onTheStandingClock(Effect.all([Clock.monotonicTimeNanos, Clock.monotonicTimeNanos, Clock.currentTimeMillis])),
    );

    expect([reads[0], reads[1], standingRenderClock(), standingRenderClock()]).toEqual([0n, 0n, 0, 0]);
    expect(reads[2]).toBeGreaterThan(0);
  });

  it('tells the time and sleeps on the clock it is given', async () => {
    const told = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_790_845_200_000);
        const clock = steppingClock(1, yield* Effect.clockWith(Effect.succeed));
        const millis = [clock.currentTimeMillisUnsafe(), yield* clock.currentTimeMillis];
        const nanos = [clock.currentTimeNanosUnsafe(), yield* clock.currentTimeNanos];
        const sleeping = yield* Effect.forkChild(clock.sleep(Duration.hours(1)));
        yield* TestClock.adjust('1 hour');
        yield* Fiber.join(sleeping);
        return { millis, nanos, after: clock.currentTimeMillisUnsafe() };
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(told).toEqual({
      millis: [1_790_845_200_000, 1_790_845_200_000],
      nanos: [1_790_845_200_000_000_000n, 1_790_845_200_000_000_000n],
      after: 1_790_848_800_000,
    });
  });
});
