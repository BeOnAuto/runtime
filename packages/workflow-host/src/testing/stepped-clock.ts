import { Effect } from 'effect';

import type { HostClock } from '../loop/host-clock.ts';
import { signals, type Signals } from './signals.ts';

export interface SteppedClock extends HostClock {
  readonly step: (milliseconds: number) => void;
  readonly asleep: () => number;
  readonly asleepAtLeast: (sleepers: number) => Promise<number>;
  readonly when: Signals['when'];
}

interface Sleeper {
  readonly until: number;
  readonly wake: () => void;
}

export function steppedClock(start: number): SteppedClock {
  const time = { now: start };
  const sleepers = new Set<Sleeper>();
  const seen = signals();
  const asleep = () => sleepers.size;
  return {
    now: () => time.now,
    sleep: (milliseconds) =>
      milliseconds <= 0
        ? Effect.void
        : Effect.callback<void>((resume) => {
            const sleeper: Sleeper = {
              until: time.now + milliseconds,
              wake: () => {
                resume(Effect.void);
              },
            };
            sleepers.add(sleeper);
            seen.changed();
            return Effect.sync(() => {
              sleepers.delete(sleeper);
            });
          }),
    step: (milliseconds) => {
      time.now += milliseconds;
      for (const sleeper of [...sleepers].filter((sleeping) => sleeping.until <= time.now)) {
        sleepers.delete(sleeper);
        sleeper.wake();
      }
    },
    asleep,
    asleepAtLeast: (count) => seen.when(asleep, (sleeping) => sleeping >= count),
    when: seen.when,
  };
}
