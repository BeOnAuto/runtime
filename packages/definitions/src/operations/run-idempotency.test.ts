import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const later = '2026-10-02T14:15:00.000Z';

async function withPlain() {
  const prober = probe();
  const operations = definitionOperationsFor([prober.capability, echo]);
  const definitions = harness();
  const creating = (name: string) =>
    definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { type: 'probe', name, source: name }));
  await creating('plain');
  await creating('other');
  const runningOf = (type: string, name: string, input: object, at?: string) =>
    definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { type, name, input, run_id: runId }), at);
  const running = (input: object = {}, at?: string) => runningOf('probe', 'plain', input, at);
  return { ...definitions, ...operations, prober, running, runningOf };
}

describe('a run that succeeded', () => {
  it('is answered again for its id without running the capability again', async () => {
    const { running, prober } = await withPlain();
    const first = await running({ who: 'Ada' });

    expect(first).toMatchObject({ status: 'succeeded', output: { run_id: runId } });
    expect(await running({ who: 'Ada' }, later)).toEqual(first);
    expect(prober.runs()).toBe(1);
  });

  it('is answered again after its definition changed or was retired', async () => {
    const { call, running, prober, retireDefinition, updateDefinition } = await withPlain();
    const first = await running();
    await call(updateDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'newer' }));

    expect(await running()).toEqual(first);
    await call(retireDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain' }));
    expect(await running()).toEqual(first);
    expect(prober.runs()).toBe(1);
  });
});

describe('a run whose input the capability rejected', () => {
  it('is rejected again for its id the same way, without running the capability again', async () => {
    const { running, prober } = await withPlain();
    const first = await running({ reject: true });

    expect(first).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(await running({ reject: true })).toEqual(first);
    expect(prober.runs()).toBe(1);
  });
});

describe('a run id', () => {
  it('belongs to one definition and one input: another type, definition or input meets conflict', async () => {
    const { running, runningOf, prober } = await withPlain();
    await running({ who: 'Ada' });
    const taken = {
      status: 'rejected',
      reason: 'conflict',
      detail: 'The run id belongs to a run of another definition or with another input',
    };

    expect(await runningOf('probe', 'other', { who: 'Ada' })).toEqual(taken);
    expect(await runningOf('echo', 'plain', { who: 'Ada' })).toEqual(taken);
    expect(await running({ who: 'Bob' })).toEqual(taken);
    expect(prober.runs()).toBe(1);
  });

  it('lets one of two calls that start it at the same moment record the start, and the other meets conflict', async () => {
    const { dispatch, runDefinition, prober, run } = await withPlain();
    const running = dispatch(runDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', run_id: runId }));

    expect(await run(Effect.all([running, running], { concurrency: 'unbounded' }))).toMatchObject([
      { status: 'succeeded' },
      { status: 'rejected', reason: 'conflict' },
    ]);
    expect(prober.runs()).toBe(1);
  });
});

describe('a run without a final result', () => {
  it('is recorded failed when its call is cancelled while the capability runs, and runs again for its id', async () => {
    const { call, callCancelledWhen, runDefinition, running, getRun, prober } = await withPlain();
    prober.sufferOnNextRun('stall');

    expect(
      await callCancelledWhen(
        prober.stalled,
        runDefinition,
        toAlpha(acmeAdmin, { type: 'probe', name: 'plain', input: {}, run_id: runId }),
      ),
    ).toEqual({ status: 'cancelled' });
    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      output: { status: 'failed', finished_at: firstMoment },
    });
    expect(await running({}, later)).toMatchObject({
      output: { status: 'succeeded', started_at: later, finished_at: later },
    });
    expect(prober.runs()).toBe(2);
  });

  it('runs the updated definition again for its id after the capability found it could not run as written', async () => {
    const { call, running, prober, updateDefinition } = await withPlain();
    prober.sufferOnNextRun('conflict');

    expect(await running()).toMatchObject({ status: 'rejected', reason: 'conflict' });
    await call(updateDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'fixed' }));
    expect(await running()).toMatchObject({
      status: 'succeeded',
      output: { definition_version: 2, status: 'succeeded' },
    });
    expect(prober.runs()).toBe(2);
  });

  it('runs again for its id after the capability was unavailable or broke down', async () => {
    const { running, prober } = await withPlain();
    prober.sufferOnNextRun('unavailable');
    await running();
    prober.sufferOnNextRun('breakdown');
    await running();

    expect(await running()).toMatchObject({ status: 'succeeded', output: { status: 'succeeded' } });
    expect(prober.runs()).toBe(3);
  });
});
