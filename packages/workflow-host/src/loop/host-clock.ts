import { Effect } from 'effect';

import type { InZone } from '../schedules/zone-clock.ts';

export interface HostClock {
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Effect.Effect<void>;
  readonly inZone?: InZone;
  readonly sweeps?: (milliseconds: number) => Effect.Effect<void>;
  /** Sleeps as `sleep` does, or until `signal` ends if it ends first, the other then interrupted. */
  readonly sleepOr?: (milliseconds: number, signal: Effect.Effect<void>) => Effect.Effect<void>;
  /**
   * Runs work that first waits its turn, such as a permit, and runs `permitted` once its turn came. The system's clock
   * has none, and the work runs as it is; a test's clock counts a fiber waiting its turn as held, so that its host can
   * come to rest while another holds the turn.
   */
  readonly queued?: <A, E, R>(
    turn: (permitted: Effect.Effect<void>) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

/**
 * Sleeps on the clock until the time given has passed or `signal` ends, whichever comes first. A clock with no
 * `sleepOr` of its own, the system's among them, races the signal against its `sleep`, the signal started first, so a
 * signal that has already ended starts no sleep.
 */
export function sleepOr(clock: HostClock, milliseconds: number, signal: Effect.Effect<void>): Effect.Effect<void> {
  return clock.sleepOr === undefined
    ? Effect.raceFirst(signal, clock.sleep(milliseconds))
    : clock.sleepOr(milliseconds, signal);
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
