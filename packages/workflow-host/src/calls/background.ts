import { Deferred, Effect, Exit, Fiber } from 'effect';

import { forkedIn, type HostContext } from '../loop/forked-fibers.ts';

export interface Background {
  readonly run: (key: string, work: Effect.Effect<void>) => void;
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
    run: (key, work) => {
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
