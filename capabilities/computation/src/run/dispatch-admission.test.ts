import { Conflict, Unavailable } from '@on.auto/operations';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Deferred, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { computationWith, functionOf, poolOf, programDocument } from '../testing/computation-runs.ts';

const program = programDocument(functionOf('return input;'), 'language: typescript\ninput: {schema: {type: object}}');

function recordedPool() {
  const pool = poolOf();
  const calls: string[] = [];
  const recording: ProgramPool = {
    ...pool,
    run: (request, signal) => {
      calls.push('sandbox');
      return pool.run(request, signal);
    },
  };
  return { pool: recording, calls };
}

describe('computation dispatch admission', () => {
  it('waits for admission before it dispatches its sandbox work', async () => {
    const { pool, calls } = recordedPool();
    const reached = Deferred.makeUnsafe<true>();
    const allowed = Deferred.makeUnsafe<true>();
    const running = computationWith(pool, {}, () =>
      Effect.asVoid(Effect.andThen(Deferred.succeed(reached, true), Deferred.await(allowed))),
    ).running(program, { value: 3 });
    await Effect.runPromise(Deferred.await(reached));

    expect(calls).toEqual([]);
    await Effect.runPromise(Deferred.succeed(allowed, true));
    expect(await running).toMatchObject(Exit.succeed({ output: { value: 3 } }));
    expect(calls).toEqual(['sandbox']);
  });

  it.each([
    () => new Conflict({ detail: 'There are not enough credits', kind: 'unworkable' }),
    () => new Unavailable({ detail: 'The meter cannot be reached' }),
  ])('preserves the admission refusal and starts no work: %#', async (refused) => {
    const refusal = refused();
    const { pool, calls } = recordedPool();
    const run = computationWith(pool, {}, () => Effect.fail(refusal));

    expect(await run.running(program, {})).toEqual(Exit.fail(refusal));
    expect(calls).toEqual([]);
  });
});

describe('computation preflight before admission', () => {
  it('does not request admission for invalid input or a missing compiled program', async () => {
    const { pool, calls } = recordedPool();
    const run = computationWith(pool, {}, () =>
      Effect.sync(() => {
        calls.push('admission');
      }),
    );

    expect(await run.running(program, 'invalid')).toMatchObject(Exit.fail({ kind: 'input_schema' }));
    expect(await run.runningUnsaved(program, {})).toMatchObject(Exit.fail({ kind: 'unworkable' }));
    expect(calls).toEqual([]);
  });

  it('performs admission once before work even when the program subsequently fails', async () => {
    const { pool, calls } = recordedPool();
    const run = computationWith(pool, {}, () =>
      Effect.sync(() => {
        calls.push('admission');
      }),
    );

    expect(await run.running(programDocument(functionOf('throw new Error("failed");')))).toMatchObject(
      Exit.fail({ kind: 'unworkable' }),
    );
    expect(calls).toEqual(['admission', 'sandbox']);
  });
});
