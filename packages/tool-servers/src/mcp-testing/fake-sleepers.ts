import { arrivals } from '../testing/arrivals.ts';

export type Sleep = (ms: number, signal: Readonly<AbortSignal>) => Promise<void>;

export interface Sleepers {
  readonly sleep: Sleep;
  readonly fire: () => void;
  readonly waited: (count: number) => Promise<void>;
}

/**
 * The sleep of every fake MCP server, in process, on a socket or over stdio: it ends when a test wakes it with `fire`,
 * or at once with the reason its call is cancelled for, never after a time. A fake over stdio is never woken, so its
 * sleep ends when the call is cancelled, or with the process when its input ends or it is killed.
 */
export function manualSleepers(): Sleepers {
  const asleep = new Set<() => void>();
  const arrived = arrivals();
  return {
    sleep: (_ms, signal) => {
      const woken = Promise.withResolvers<void>();
      if (signal.aborted) {
        woken.reject(signal.reason);
        return woken.promise;
      }
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
