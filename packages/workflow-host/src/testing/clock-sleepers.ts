import { Effect, Function } from 'effect';

import { InForkedFiber, type FiberWatch, type ForkedFiber } from '../loop/forked-fibers.ts';
import type { HostClock } from '../loop/host-clock.ts';
import type { Signals } from './signals.ts';

/**
 * Work the test holds. A fiber waiting for it counts as asleep on the clock, no step ends the wait, and the wait ends
 * when the test lets it go: at once then, the fiber no longer counted asleep, so the host is not at rest again until it is.
 */
export interface HeldWork {
  readonly wait: Effect.Effect<void>;
  readonly release: () => void;
}

export interface Sleeper {
  readonly until: number;
  readonly wake: () => void;
  readonly fiber: ForkedFiber | undefined;
}

interface WatchedFibers {
  readonly watch: FiberWatch;
  readonly watched: () => boolean;
  readonly living: () => number;
  readonly awake: (sleepers: ReadonlySet<Sleeper>) => readonly string[];
}

/** The fibers a host forked, counted while they live, each end said to the signals. */
export function watchedFibers(seen: Signals): WatchedFibers {
  const counts = { forked: 0 };
  const living = new Set<{ readonly fiber: ForkedFiber }>();
  return {
    watch: {
      forked: (whenEnded, fiber) => {
        const forked = { fiber };
        counts.forked += 1;
        living.add(forked);
        whenEnded(() => {
          living.delete(forked);
          seen.changed();
        });
      },
    },
    watched: () => counts.forked > 0,
    living: () => living.size,
    awake: (sleepers) => {
      const asleep = new Set([...sleepers].map(({ fiber }) => fiber));
      return [...living].filter(({ fiber }) => !asleep.has(fiber)).map(({ fiber }) => fiber.label);
    },
  };
}

/** The fiber of the host the effect runs in, for a sleeper to say whose it is. */
function inItsFiber<A, E, R>(
  effect: (fiber: ForkedFiber | undefined) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.flatMap(Effect.service(InForkedFiber), effect);
}

export function sleepOn(time: { readonly now: number }, sleepers: Set<Sleeper>, seen: Signals): HostClock['sleep'] {
  return (milliseconds) =>
    milliseconds <= 0
      ? Effect.void
      : inItsFiber((fiber) =>
          Effect.callback<void>((resume) => {
            const sleeper: Sleeper = {
              until: time.now + milliseconds,
              wake: () => {
                resume(Effect.void);
              },
              fiber,
            };
            sleepers.add(sleeper);
            seen.changed();
            return Effect.sync(() => {
              sleepers.delete(sleeper);
            });
          }),
        );
}

/**
 * A sleep that a signal ends early. The signal starts first, as on the system's clock, so a signal that has already
 * ended puts no sleeper on the clock, not even for a moment. The sleeper leaves the clock as the signal ends, in the
 * same turn, so a host whose signal fired is not counted asleep while it goes on to work: a plain race would leave it
 * asleep on the clock until the race interrupted it.
 */
export function sleepOrOn(
  time: { readonly now: number },
  sleepers: Set<Sleeper>,
  seen: Signals,
): NonNullable<HostClock['sleepOr']> {
  return (milliseconds, signal) =>
    milliseconds <= 0
      ? Effect.void
      : inItsFiber((fiber) => {
          const woken = { resume: Function.constVoid };
          const sleeper: Sleeper = {
            until: time.now + milliseconds,
            wake: () => {
              woken.resume();
            },
            fiber,
          };
          const left = Effect.sync(() => {
            sleepers.delete(sleeper);
          });
          const slept = Effect.callback<void>((resume) => {
            woken.resume = () => {
              resume(Effect.void);
            };
            sleepers.add(sleeper);
            seen.changed();
            return left;
          });
          return Effect.raceFirst(Effect.andThen(signal, left), slept);
        });
}

export function heldOn(sleepers: Set<Sleeper>, seen: Signals): HeldWork {
  const held = { released: false };
  const waiting = new Set<Sleeper>();
  return {
    wait: inItsFiber((fiber) =>
      Effect.callback<void>((resume) => {
        if (held.released) {
          resume(Effect.void);
          return Effect.void;
        }
        const sleeper: Sleeper = {
          until: Number.POSITIVE_INFINITY,
          wake: () => {
            resume(Effect.void);
          },
          fiber,
        };
        sleepers.add(sleeper);
        waiting.add(sleeper);
        seen.changed();
        return Effect.sync(() => {
          sleepers.delete(sleeper);
          waiting.delete(sleeper);
        });
      }),
    ),
    release: () => {
      held.released = true;
      for (const sleeper of waiting) {
        sleepers.delete(sleeper);
        waiting.delete(sleeper);
        sleeper.wake();
      }
    },
  };
}

/**
 * Work waiting its turn, held on the clock as work the test holds is: no step ends the wait, which ends as `permitted`
 * runs, or as the work ends without its turn, interrupted while it waited. `ended` is told as each turn ends, its
 * permit let go by then.
 */
export function queuedOn(sleepers: Set<Sleeper>, seen: Signals, ended: () => void): NonNullable<HostClock['queued']> {
  return (turn) =>
    inItsFiber((fiber) =>
      Effect.suspend(() => {
        const sleeper: Sleeper = { until: Number.POSITIVE_INFINITY, wake: Function.constVoid, fiber };
        const permitted = Effect.sync(() => {
          sleepers.delete(sleeper);
        });
        sleepers.add(sleeper);
        seen.changed();
        return Effect.ensuring(turn(permitted), Effect.andThen(permitted, Effect.sync(ended)));
      }),
    );
}
