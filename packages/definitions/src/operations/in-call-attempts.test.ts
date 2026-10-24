import { Deferred, Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { liveAttemptsLayer } from '../attempts/live-attempts.ts';
import { linksIn } from '../journal-testing/run-links.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { heldAfterItsCall, momentAfter, startedAndLeft } from '../testing/resumed-runs.ts';
import { testRunId } from '../testing/run-facts.ts';

describe('an attempt of a run of a capability that does not resume', () => {
  it('is made in the call of its caller, the attempts live in the process keeping it once', async () => {
    const { createDefinition, runDefinition } = definitionOperationsFor([echo]);
    const { dispatch, run: within, call } = harness();
    const toAlpha = toPlaybook('acme', 'alpha');
    await call(createDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }));
    const asked = toAlpha(acmeAdmin, { type: 'echo', name: 'greet', input: {}, run_id: testRunId });

    const answers = await within(
      Effect.all([dispatch(runDefinition, asked), dispatch(runDefinition, asked)], { concurrency: 'unbounded' }).pipe(
        Effect.provide(liveAttemptsLayer),
      ),
    );

    expect(answers).toMatchObject([
      { status: 'succeeded', output: { status: 'succeeded' } },
      { status: 'succeeded', output: { status: 'succeeded' } },
    ]);
  });
});

describe("an attempt of a run of a capability that resumes, asked by a workflow's call", () => {
  it('is made in that call: stopped with it, as by a host that stands by, it records no ending, and the next perform goes on with it', async () => {
    const held = heldAfterItsCall();
    const definitions = await startedAndLeft({ afterItsCall: held.afterItsCall });

    const resumed = await definitions.run(
      Effect.gen(function* () {
        const call = yield* Effect.forkChild(definitions.askedByACall(true));
        yield* Deferred.await(held.called);
        yield* Fiber.interrupt(call);
        yield* Deferred.succeed(held.released, true);
        return yield* definitions.askedByACall(true);
      }).pipe(Effect.provide(liveAttemptsLayer)),
      momentAfter(1000),
    );

    expect(resumed).toMatchObject({ status: 'succeeded' });
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
      'model_call_started',
      'run_succeeded',
    ]);
    expect(definitions.resuming.contexts()).toHaveLength(2);
  });
});
