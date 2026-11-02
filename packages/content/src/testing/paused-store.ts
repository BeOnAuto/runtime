import { Effect, Function } from 'effect';

import type { ContentStore } from '../content/recorded-content.ts';

export interface PausedStep {
  readonly reached: Promise<void>;
  readonly release: () => void;
  readonly fail: () => void;
}

export interface PausableStore {
  readonly store: ContentStore;
  readonly pausedDelete: () => PausedStep;
  readonly pausedPlace: () => PausedStep;
}

interface Pause {
  readonly reach: () => void;
  readonly passed: Promise<boolean>;
}

interface Pauses {
  readonly next: () => PausedStep;
  readonly through: <A>(step: Effect.Effect<A>) => Effect.Effect<A>;
}

export function aStepFailedAtItsPause(): Error {
  return new Error('The store was told to fail the step it paused');
}

function pausesOf(): Pauses {
  const waiting: Pause[] = [];
  return {
    next: () => {
      const reached = Promise.withResolvers<void>();
      const passed = Promise.withResolvers<boolean>();
      waiting.push({
        reach: () => {
          reached.resolve();
        },
        passed: passed.promise,
      });
      return {
        reached: reached.promise,
        release: () => {
          passed.resolve(true);
        },
        fail: () => {
          passed.resolve(false);
        },
      };
    },
    through: (step) =>
      Effect.suspend(() => {
        const pause = waiting.shift();
        if (pause === undefined) {
          return step;
        }
        pause.reach();
        return Effect.flatMap(
          Effect.promise(() => pause.passed),
          (passes) => (passes ? step : Effect.die(aStepFailedAtItsPause())),
        );
      }),
  };
}

export function pausableStore(store: ContentStore): PausableStore {
  const deletes = pausesOf();
  const places = pausesOf();
  return {
    store: {
      ...store,
      stage: (playbook, content) =>
        Effect.map(store.stage(playbook, content), (staged) => ({
          ...staged,
          placed: (mediaType: string) => places.through(staged.placed(mediaType)),
        })),
      delete: (playbook, sha256) => deletes.through(store.delete(playbook, sha256)),
    },
    pausedDelete: deletes.next,
    pausedPlace: places.next,
  };
}

export function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  const waited = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      resolve(false);
    }, ms);
  });
  return Promise.race([work.then(Function.constTrue, Function.constTrue), waited]);
}

export function defectOf<E>(work: Effect.Effect<unknown, E>): Effect.Effect<unknown, E> {
  return Effect.catchDefect(Effect.asVoid(work), Effect.succeed);
}
