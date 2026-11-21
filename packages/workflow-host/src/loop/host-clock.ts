import { Effect } from 'effect';

import type { InZone } from '../schedules/zone-clock.ts';

export interface HostClock {
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Effect.Effect<void>;
  readonly inZone?: InZone;
  readonly sweeps?: (milliseconds: number) => Effect.Effect<void>;
}

export const systemClock: HostClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => Effect.sleep(milliseconds),
};

export function skippingClock(start: number, sweeps?: HostClock['sweeps']): HostClock {
  const time = { now: start };
  return {
    ...(sweeps === undefined ? {} : { sweeps }),
    now: () => time.now,
    sleep: (milliseconds) =>
      Effect.sync(() => {
        time.now += milliseconds;
      }).pipe(Effect.andThen(Effect.yieldNow)),
  };
}
