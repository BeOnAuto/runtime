import { Clock, DateTime, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { clockRunningFrom, startedAt } from './suite-clock.ts';

const nanosecondsInAMillisecond = 1_000_000n;

describe('a clock running from a moment', () => {
  it('reads the moment it starts from and runs on across a sleep at the pace of the real clock, on a monotonic time that stands still', async () => {
    const real = Clock.Clock.defaultValue();
    const before = real.currentTimeMillisUnsafe();
    const clock = clockRunningFrom(startedAt);
    const after = real.currentTimeMillisUnsafe();
    const { slept, first, shifted, last } = await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Clock.monotonicTimeNanos;
        yield* Effect.sleep('5 millis');
        const ended = yield* Clock.monotonicTimeNanos;
        const firstRead = { millis: real.currentTimeMillisUnsafe(), nanos: real.currentTimeNanosUnsafe() };
        const millis = yield* Clock.currentTimeMillis;
        const nanos = yield* Clock.currentTimeNanos;
        const at = DateTime.toEpochMillis(yield* DateTime.now);
        const lastRead = { millis: real.currentTimeMillisUnsafe(), nanos: real.currentTimeNanosUnsafe() };
        return { slept: ended - started, first: firstRead, shifted: { millis, nanos, at }, last: lastRead };
      }).pipe(Effect.provideService(Clock.Clock, clock)),
    );
    const shiftedNanos = shifted.nanos - BigInt(startedAt) * nanosecondsInAMillisecond;

    expect(slept).toBe(0n);
    for (const millis of [shifted.millis, shifted.at]) {
      expect(millis - startedAt).toBeGreaterThanOrEqual(first.millis - after);
      expect(millis - startedAt).toBeLessThanOrEqual(last.millis - before);
    }
    expect(shiftedNanos).toBeGreaterThanOrEqual(first.nanos - BigInt(after) * nanosecondsInAMillisecond);
    expect(shiftedNanos).toBeLessThanOrEqual(last.nanos - BigInt(before) * nanosecondsInAMillisecond);
  });
});
