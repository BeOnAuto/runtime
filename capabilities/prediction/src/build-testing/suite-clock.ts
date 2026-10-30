import { steppingClock } from '@on.auto/definitions/testing';
import { Clock, Effect } from 'effect';

import { periodOfMoment } from '../periods/moments.ts';

export const startedAt = Date.parse('2026-10-12T09:00:00.000Z');

export const today = periodOfMoment('day', startedAt);

const nanosecondsInAMillisecond = 1_000_000n;

export function clockRunningFrom(moment: number, sleep?: Clock.Clock['sleep']): Clock.Clock {
  const real = Clock.Clock.defaultValue();
  const shift = moment - real.currentTimeMillisUnsafe();
  const millis = () => real.currentTimeMillisUnsafe() + shift;
  const nanos = () => real.currentTimeNanosUnsafe() + BigInt(shift) * nanosecondsInAMillisecond;
  return steppingClock(0, {
    currentTimeMillisUnsafe: millis,
    currentTimeMillis: Effect.sync(millis),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: real.monotonicTimeNanosUnsafe.bind(real),
    monotonicTimeNanos: real.monotonicTimeNanos,
    sleep: sleep ?? real.sleep.bind(real),
  });
}
