import { Deferred, Effect, Exit, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { runSerialiser } from './run-serialiser.ts';

interface Journal {
  readonly step: (line: string) => Effect.Effect<void>;
  readonly lines: () => readonly string[];
}

function journal(): Journal {
  const lines: string[] = [];
  return {
    step: (line) =>
      Effect.sync(() => {
        lines.push(line);
      }),
    lines: () => lines,
  };
}

describe('the serialiser of the host', () => {
  it('takes one input of a run at a time, and inputs of two runs at once', async () => {
    const { serialise } = runSerialiser();
    const { step, lines } = journal();
    const release = Deferred.makeUnsafe<void>();
    const held = step('first of alpha begins').pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.andThen(step('first of alpha ends')),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(serialise('alpha', held));
        yield* Effect.yieldNow;
        const second = yield* Effect.forkChild(serialise('alpha', step('second of alpha')));
        yield* serialise('beta', step('first of beta'));
        yield* Deferred.done(release, Exit.void);
        yield* Fiber.joinAll([first, second]);
        yield* serialise('alpha', step('third of alpha'));
      }),
    );

    expect(lines()).toEqual([
      'first of alpha begins',
      'first of beta',
      'first of alpha ends',
      'second of alpha',
      'third of alpha',
    ]);
  });
});
