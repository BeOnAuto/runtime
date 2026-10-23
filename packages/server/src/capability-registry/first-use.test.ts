import { makeAppRuntime } from '@on.auto/api';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Context, Effect, Exit, Layer, Scope } from 'effect';
import { describe, expect, it } from 'vitest';

import { composedOnFirstUse, scopeOfTheRuntime } from './first-use.ts';

interface Composition {
  readonly number: number;
}

class Composed extends Context.Service<Composed, Composition>()('test/Composed') {}

interface Counted {
  readonly composed: () => number;
  readonly ended: () => number;
  readonly layer: Layer.Layer<Composed, Error>;
}

function counted(failing: (attempt: number) => boolean = () => false): Counted {
  const counts = { composed: 0, ended: 0 };
  const composing = Effect.suspend(() => {
    counts.composed += 1;
    const attempt = counts.composed;
    return failing(attempt) ? Effect.fail(new Error(`attempt ${attempt} failed`)) : Effect.succeed({ number: attempt });
  });
  const ending = Effect.sync(() => {
    counts.ended += 1;
  });
  return {
    composed: () => counts.composed,
    ended: () => counts.ended,
    layer: Layer.effect(
      Composed,
      Effect.acquireRelease(composing, () => ending),
    ),
  };
}

async function openedOver(layer: Layer.Layer<Composed, Error>) {
  const scope = Scope.makeUnsafe();
  const firstUse = await Effect.runPromise(Scope.provide(composedOnFirstUse(Composed, layer), scope));
  return { firstUse, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}

describe('a composition on first use', () => {
  it('composes nothing until it is asked for', async () => {
    const counts = counted();
    const { close } = await openedOver(counts.layer);

    await close();

    expect([counts.composed(), counts.ended()]).toEqual([0, 0]);
  });

  it('composes the first time it is asked for, and answers that same composition ever after', async () => {
    const counts = counted();
    const { firstUse, close } = await openedOver(counts.layer);

    const first = await Effect.runPromise(firstUse);
    const second = await Effect.runPromise(firstUse);
    await close();

    expect({ same: first === second, composed: counts.composed(), first }).toEqual({
      same: true,
      composed: 1,
      first: { number: 1 },
    });
  });

  it('composes once when it is asked for many times at once', async () => {
    const counts = counted();
    const { firstUse, close } = await openedOver(counts.layer);

    const answers = await Effect.runPromise(Effect.all([firstUse, firstUse, firstUse], { concurrency: 'unbounded' }));
    await close();

    expect({ numbers: answers.map(({ number }) => number), composed: counts.composed() }).toEqual({
      numbers: [1, 1, 1],
      composed: 1,
    });
  });
});

describe('a composition on first use that fails or ends', () => {
  it('answers a failed composition with its failure, and composes again the next time it is asked for', async () => {
    const counts = counted((attempt) => attempt === 1);
    const { firstUse, close } = await openedOver(counts.layer);

    const failed = await Effect.runPromise(Effect.flip(firstUse));
    const composed = await Effect.runPromise(firstUse);
    const kept = await Effect.runPromise(firstUse);
    await close();

    expect({ failed: failed.message, composed, kept, attempts: counts.composed() }).toEqual({
      failed: 'attempt 1 failed',
      composed: { number: 2 },
      kept: { number: 2 },
      attempts: 2,
    });
  });

  it('ends the composition it holds once, when it is closed', async () => {
    const counts = counted();
    const { firstUse, close } = await openedOver(counts.layer);
    await Effect.runPromise(firstUse);
    await Effect.runPromise(firstUse);

    const before = counts.ended();
    await close();

    expect([before, counts.ended()]).toEqual([0, 1]);
  });
});

describe('the scope of the runtime that holds the compositions', () => {
  it('closes what it holds when the runtime is disposed, before the services the runtime built first', async () => {
    const ended: string[] = [];
    const endingAs = (name: string) =>
      Effect.addFinalizer(() =>
        Effect.sync(() => {
          ended.push(name);
        }),
      );
    const services = Layer.mergeAll(
      memoryLedger().layer,
      memoryPlaybookRegistry([]),
      recordingReporter().layer,
      Layer.effectDiscard(endingAs('services')),
    );
    const { closedFirstOf, openedIn } = scopeOfTheRuntime();
    const runtime = await makeAppRuntime(closedFirstOf(services));
    await openedIn(runtime, endingAs('compositions'));

    const beforeDisposal = [...ended];
    await runtime.dispose();

    expect({ beforeDisposal, ended }).toEqual({ beforeDisposal: [], ended: ['compositions', 'services'] });
  });
});
