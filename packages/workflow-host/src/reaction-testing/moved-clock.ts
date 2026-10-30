import { Effect } from 'effect';

import type { HostClock } from '../loop/host-clock.ts';
import { zoneClockOf } from '../schedules/zone-clock.ts';

export interface MovedClock extends HostClock {
  readonly moveTo: (at: number) => void;
  readonly forgetZone: (timeZone: string) => void;
}

const aBreath = 5;

export function movedClock(start: number): MovedClock {
  const time = { now: start };
  const forgotten = new Set<string>();
  return {
    now: () => time.now,
    sleep: (milliseconds) => Effect.sleep(Math.min(milliseconds, aBreath)),
    inZone: (timeZone) => {
      if (forgotten.has(timeZone)) {
        throw new RangeError(`Invalid time zone specified: ${timeZone}`);
      }
      return zoneClockOf(timeZone);
    },
    moveTo: (at) => {
      time.now = at;
    },
    forgetZone: (timeZone) => {
      forgotten.add(timeZone);
    },
  };
}
