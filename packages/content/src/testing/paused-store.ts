import { Effect, Function, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { onTestFinished } from 'vitest';

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
      stage: (place, content) =>
        Effect.map(store.stage(place, content), (staged) => ({
          ...staged,
          placed: (mediaType: string) => places.through(staged.placed(mediaType)),
        })),
      delete: (place, sha256) => deletes.through(store.delete(place, sha256)),
    },
    pausedDelete: deletes.next,
    pausedPlace: places.next,
  };
}

/** Whether the work has settled by the turn after every step it could take without waiting on anything. */
export function settledYet(work: Promise<unknown>): Promise<boolean> {
  const turned = new Promise<boolean>((resolve) => {
    setImmediate(() => {
      resolve(false);
    });
  });
  return Promise.race([work.then(Function.constTrue, Function.constTrue), turned]);
}

export interface OnATestClock {
  readonly run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly advance: (milliseconds: number) => Promise<void>;
}

/** Runs effects on one test clock set to the moment given, which sleeps only as far as the test advances it. */
export function onATestClock(moment: number = Date.now()): OnATestClock {
  const runtime = ManagedRuntime.make(TestClock.layer());
  onTestFinished(() => runtime.dispose());
  const set = runtime.runPromise(TestClock.setTime(moment));
  return {
    run: (effect) => set.then(() => runtime.runPromise(effect)),
    advance: (milliseconds) => set.then(() => runtime.runPromise(TestClock.adjust(milliseconds))),
  };
}

export function defectOf<E>(work: Effect.Effect<unknown, E>): Effect.Effect<unknown, E> {
  return Effect.catchDefect(Effect.asVoid(work), Effect.succeed);
}
