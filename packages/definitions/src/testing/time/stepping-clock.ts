import { Clock, Effect } from 'effect';

import { renderClockOf, type RenderClock } from '../../template/render-clock.ts';

const nanosecondsInAMillisecond = 1_000_000n;

export function steppingClock(stepMs: number, wall: Clock.Clock = Clock.Clock.defaultValue()): Clock.Clock {
  const time = { nanos: 0n };
  const monotonic = (): bigint => {
    const read = time.nanos;
    time.nanos += BigInt(stepMs) * nanosecondsInAMillisecond;
    return read;
  };
  return {
    currentTimeMillisUnsafe: () => wall.currentTimeMillisUnsafe(),
    currentTimeMillis: wall.currentTimeMillis,
    currentTimeNanosUnsafe: () => wall.currentTimeNanosUnsafe(),
    currentTimeNanos: wall.currentTimeNanos,
    monotonicTimeNanosUnsafe: monotonic,
    monotonicTimeNanos: Effect.sync(monotonic),
    sleep: wall.sleep.bind(wall),
  };
}

export const standingClock: Clock.Clock = steppingClock(0);

export const standingRenderClock: RenderClock = renderClockOf(standingClock);

export function onTheStandingClock<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.provideService(effect, Clock.Clock, standingClock);
}
