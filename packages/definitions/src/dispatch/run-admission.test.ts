import { Conflict, Unavailable, type CallLink } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  admittedRuns,
  asked,
  recordedAdmission,
  repeatedAdmission,
  runId,
  source,
  toAlpha,
} from '../dispatch-testing/admitted-runs.ts';
import { defineStartVersion, RunAdmission, type RunDispatch } from '../index.ts';
import { acmeAdmin, acmeReader } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { momentAfter, startedAndLeft } from '../testing/resumed-runs.ts';
import { testRunId } from '../testing/run-facts.ts';

describe('the run dispatch bound to its prepared definition', () => {
  it('supplies the actual scope, immutable version, input and caller before work and skips a recorded answer', async () => {
    const { seen, service } = recordedAdmission();
    const f = await admittedRuns(service);

    expect(await f.running()).toMatchObject({ status: 'succeeded' });
    expect(await f.running()).toMatchObject({ status: 'succeeded' });
    expect(seen).toEqual([
      {
        org: 'acme',
        playbook: 'alpha',
        runId,
        definition: { type: 'echo', name: 'greet', version: 1, source },
        input: { name: 'Ada' },
        caller: acmeAdmin,
        calledBy: null,
        trigger: null,
      },
    ]);
  });

  it('retains the runtime supplied parent and trigger on starts of a fixed version', async () => {
    const { seen, service } = recordedAdmission();
    const f = await admittedRuns(service);
    const calledBy: CallLink = { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70', reference: '/do/0/step', run: 1 };
    const trigger = { kind: 'every' as const, reference: '/schedule/every' };
    const request = { ...toAlpha(acmeAdmin, { ...asked, version: 1 }), calledBy, trigger };

    expect(await f.call(defineStartVersion([echo]), request)).toMatchObject({ status: 'succeeded' });
    expect(seen).toMatchObject([{ runId, definition: { source, version: 1 }, calledBy, trigger }]);
  });
});

describe('the recorded funding lineage on a resumed run', () => {
  it('does not adopt a new parent supplied by the retrying call', async () => {
    const { seen, service } = recordedAdmission();
    const f = await startedAndLeft();

    const result = await f.run(f.askedByACall(true).pipe(Effect.provideService(RunAdmission, service)), momentAfter(1));

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(seen).toMatchObject([{ calledBy: null, trigger: null }]);
  });

  it('retains the original parent and trigger when a retry supplies neither', async () => {
    const { seen, service } = recordedAdmission();
    const calledBy: CallLink = { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70', reference: '/do/0/step', run: 1 };
    const trigger = { kind: 'every' as const, reference: '/schedule/every' };
    const f = await startedAndLeft({}, { called_by: calledBy, trigger });

    const result = await f.run(f.asking(true).pipe(Effect.provideService(RunAdmission, service)), momentAfter(1));

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(seen).toMatchObject([{ calledBy, trigger }]);
  });
});

describe('admission and input or permission refusals', () => {
  it('does not request dispatch for invalid input or a caller without run permission', async () => {
    const { seen, service } = recordedAdmission();
    const f = await admittedRuns(service);

    expect(await f.call(f.operations.runDefinition, toAlpha(acmeAdmin, { ...asked, input: 'invalid' }))).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
    });
    expect(await f.call(f.operations.runDefinition, toAlpha(acmeReader, asked))).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
    });
    expect(seen).toEqual([]);
  });

  it.each([
    () => new Conflict({ detail: 'There are not enough credits', kind: 'unworkable' }),
    () => new Unavailable({ detail: 'The meter cannot be reached' }),
  ])('records and returns the admission refusal without completing the run: %#', async (refused) => {
    const refusal = refused();
    const f = await admittedRuns({ dispatch: () => Effect.fail(refusal) });

    expect(await f.running()).toMatchObject({ status: 'rejected', detail: refusal.detail });
    expect(await f.definitions.call(f.operations.getRun, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      output: { status: 'rejected', rejection: { detail: refusal.detail } },
    });
  });
});

describe('a captured admission request', () => {
  it('gives each dispatch check its own copy without changing the prepared input or authority', async () => {
    const seen: RunDispatch[] = [];
    const f = await admittedRuns(
      {
        dispatch: (run) =>
          Effect.sync(() => {
            seen.push(structuredClone(run));
            Object.assign(run.definition, { source: 'changed', version: 50 });
            Object.assign(run.caller, { id: 'changed' });
            Object.assign(run, { input: { name: 'changed' } });
          }),
      },
      repeatedAdmission,
    );

    expect(await f.running()).toMatchObject({ output: { output: { greeting: 'Hello', input: { name: 'Ada' } } } });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(seen[1]);
    expect(seen[0]).toMatchObject({ definition: { source, version: 1 }, input: { name: 'Ada' }, caller: acmeAdmin });
  });

  it('uses the recorded definition version and logical run identity when an attempt resumes', async () => {
    const { seen, service } = recordedAdmission();
    const f = await startedAndLeft();
    const resumed = await f.run(f.asking(true).pipe(Effect.provideService(RunAdmission, service)), momentAfter(1));

    expect(resumed).toMatchObject({ status: 'succeeded', output: { definition_version: 1 } });
    expect(seen).toMatchObject([
      {
        runId: testRunId,
        definition: { type: 'resumer', name: 'step', version: 1, source: 'first' },
        input: {},
      },
    ]);
  });
});
