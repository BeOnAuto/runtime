import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { clockAt } from './index.ts';

describe('the clock of the harness', () => {
  it('reads the wall time it is given, in milliseconds and nanoseconds, and stands still on its monotonic time', async () => {
    const clock = clockAt(() => 1500);

    expect([
      clock.currentTimeMillisUnsafe(),
      clock.currentTimeNanosUnsafe(),
      await Effect.runPromise(clock.currentTimeNanos),
      clock.monotonicTimeNanosUnsafe(),
      await Effect.runPromise(clock.monotonicTimeNanos),
    ]).toEqual([1500, 1_500_000_000n, 1_500_000_000n, 0n, 0n]);
  });
});
