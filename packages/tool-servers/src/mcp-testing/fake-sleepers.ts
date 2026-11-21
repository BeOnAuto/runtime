import { setTimeout } from 'node:timers/promises';

import { arrivals } from '../testing/arrivals.ts';

export type Sleep = (ms: number, signal: Readonly<AbortSignal>) => Promise<void>;

export interface Sleepers {
  readonly sleep: Sleep;
  readonly fire: () => void;
  readonly waited: (count: number) => Promise<void>;
}

export const realSleep: Sleep = async (ms, signal) => {
  await setTimeout(ms, undefined, { signal });
};

export function manualSleepers(): Sleepers {
  const asleep = new Set<() => void>();
  const arrived = arrivals();
  return {
    sleep: (_ms, signal) => {
      const woken = Promise.withResolvers<void>();
      const wake = () => {
        asleep.delete(wake);
        woken.resolve();
      };
      asleep.add(wake);
      arrived.arrive();
      signal.addEventListener(
        'abort',
        () => {
          asleep.delete(wake);
          woken.reject(signal.reason);
        },
        { once: true },
      );
      return woken.promise;
    },
    fire: () => {
      for (const wake of asleep) {
        wake();
      }
    },
    waited: arrived.reached,
  };
}
