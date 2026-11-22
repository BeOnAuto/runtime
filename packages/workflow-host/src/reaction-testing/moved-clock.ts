import type { HostClock } from '../loop/host-clock.ts';
import { zoneClockOf } from '../schedules/zone-clock.ts';
import { steppedClock, type SteppedClock } from '../testing/stepped-clock.ts';

interface MovedTime {
  readonly moveTo: (at: number) => void;
  readonly forgetZone: (timeZone: string) => void;
}

export interface SteppedMovedClock extends SteppedClock, Pick<HostClock, 'inZone'>, MovedTime {}

/**
 * A moved clock on which time moves only when the test moves it: to a moment, with `moveTo`, or by the sweeps it
 * names (`steppedBy`). A sleep of the host ends only once the time reaches it.
 */
export function steppedMovedClock(start: number): SteppedMovedClock {
  const stepped = steppedClock(start);
  const forgotten = new Set<string>();
  return {
    ...stepped,
    inZone: (timeZone) => {
      if (forgotten.has(timeZone)) {
        throw new RangeError(`Invalid time zone specified: ${timeZone}`);
      }
      return zoneClockOf(timeZone);
    },
    moveTo: (at) => {
      stepped.step(at - stepped.now());
    },
    forgetZone: (timeZone) => {
      forgotten.add(timeZone);
    },
  };
}
