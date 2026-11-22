import { Deferred, Effect, Exit, Fiber, type Semaphore } from 'effect';

import { forkedIn, type HostContext } from '../loop/forked-fibers.ts';
import type { HostClock } from '../loop/host-clock.ts';

export type InTurn = <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

/** The work once a permit is free, the permit held while it runs, its wait for the permit queued on the clock where it can be. */
export function takingTurns(atOnce: Semaphore.Semaphore, queued: HostClock['queued']): InTurn {
  return queued === undefined
    ? (work) => atOnce.withPermit(work)
    : (work) => queued((permitted) => atOnce.withPermit(Effect.andThen(permitted, work)));
}

export interface Background {
  readonly run: (key: string, work: Effect.Effect<void>, label?: string) => void;
  readonly has: (key: string) => boolean;
  readonly size: () => number;
  readonly awaited: (keys: readonly string[]) => Effect.Effect<void>;
  readonly interrupt: (key: string) => Effect.Effect<void>;
  readonly idle: () => Effect.Effect<void>;
  readonly stop: () => Effect.Effect<void>;
}

export function background(context?: HostContext): Background {
  const fibers = new Map<string, Fiber.Fiber<void>>();
  const lifecycle = { stopped: false };
  return {
    run: (key, work, label) => {
      if (lifecycle.stopped || fibers.has(key)) {
        return;
      }
      const gate = Deferred.makeUnsafe<void>();
      const fiber = forkedIn(
        context,
        Deferred.await(gate).pipe(
          Effect.andThen(work),
          Effect.ensuring(
            Effect.sync(() => {
              fibers.delete(key);
            }),
          ),
        ),
        label ?? key,
      );
      fibers.set(key, fiber);
      Deferred.doneUnsafe(gate, Exit.void);
    },
    has: (key) => fibers.has(key),
    size: () => fibers.size,
    awaited: (keys) =>
      Effect.suspend(() =>
        Effect.asVoid(
          Fiber.awaitAll(
            keys.flatMap((key) => {
              const fiber = fibers.get(key);
              return fiber === undefined ? [] : [fiber];
            }),
          ),
        ),
      ),
    interrupt: (key) =>
      Effect.suspend(() => {
        const fiber = fibers.get(key);
        return fiber === undefined ? Effect.void : Fiber.interrupt(fiber);
      }),
    idle: () => Effect.suspend(() => Effect.asVoid(Fiber.awaitAll([...fibers.values()]))),
    stop: () =>
      Effect.suspend(() => {
        lifecycle.stopped = true;
        return Fiber.interruptAll([...fibers.values()]);
      }),
  };
}
