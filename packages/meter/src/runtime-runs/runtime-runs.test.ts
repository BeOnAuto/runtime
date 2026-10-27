import { statement } from '@on.auto/ledger';
import { runChargeId } from '@on.auto/metering';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { selfHostedRuns } from '../index.ts';
import { assertOfflineConservation } from '../offline-testing/fixture.ts';
import { dispatchRequest, runId, runtimeFixture } from '../runtime-testing/fixture.ts';

async function reservationId() {
  return `reservation:${await runChargeId({ accountId: 'account-1', deploymentId: 'installation-1', playbookId: 'runtime:acme:alpha', runId }, 'platform')}`;
}

describe('a licensed computation through Runtime operations', () => {
  it('activates, dispatches once, reconciles its ending and reports one platform credit', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');

    expect(await f.runtime.run()).toMatchObject({ status: 'succeeded', output: { output: { doubled: 6 } } });
    expect(await f.runtime.run()).toMatchObject({ status: 'succeeded' });
    expect(f.dispatched).toHaveLength(1);
    expect(await f.reconcile()).toMatchObject({ inspected: 1, settled: 1, failed: 0, pending: 0 });
    expect(await f.reconcile()).toMatchObject({ inspected: 0 });
    await f.meter.maintain();
    expect(f.received).toHaveLength(1);
    expect(f.received[0]?.charges).toHaveLength(1);
    expect((await f.meter.capacity())?.counters).toMatchObject([{ committedUnits: 1_000_000n, reservedUnits: 0n }]);
    expect((await f.meter.accounting.reservation(await reservationId()))?.state).toBe('settled');
    expect(f.runtime.reported()).toEqual([]);
    await assertOfflineConservation(f.options.connection);
  });

  it('runs no sandbox before activation or when the input fails validation', async () => {
    const f = await runtimeFixture();

    expect(await f.runtime.run()).toMatchObject({ status: 'rejected', reason: 'conflict' });
    await f.meter.license.activate('activation-secret');
    expect(await f.runtime.run(crypto.randomUUID(), 'invalid')).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
    });
    expect(f.dispatched).toEqual([]);
    expect(await f.reconcile()).toMatchObject({ inspected: 0 });
    expect((await f.meter.capacity())?.counters).toMatchObject([{ committedUnits: 0n, reservedUnits: 0n }]);
  });
});

describe('durable Runtime admission', () => {
  it('reuses the same quote and charge after restart despite a later clock sample', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    await Effect.runPromise(f.runs.admission.dispatch(dispatchRequest()));
    f.pass(30_000);
    const replica = selfHostedRuns({ ...f.runOptions, meter: await f.restart() });

    await Effect.runPromise(replica.admission.dispatch(dispatchRequest()));
    expect(await f.options.connection.read(statement`SELECT id FROM meter_reservations`)).toHaveLength(1);
    expect(await f.options.connection.read(statement`SELECT id FROM meter_offline_charges`)).toHaveLength(1);
    expect(await f.reconcile()).toMatchObject({ inspected: 1, pending: 1, settled: 0 });
    await assertOfflineConservation(f.options.connection);
  });

  it('refuses nested or unbounded work without holding or charging credits', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    const root = dispatchRequest();
    const nested = dispatchRequest({ calledBy: { run_id: crypto.randomUUID(), reference: '/do/a', run: 1 } });

    const deniedNested = await Effect.runPromise(Effect.flip(f.runs.admission.dispatch(nested)));
    const deniedWorkflow = await Effect.runPromise(
      Effect.flip(f.runs.admission.dispatch({ ...root, definition: { ...root.definition, type: 'workflow' } })),
    );
    expect(deniedNested.detail).toContain('approved bound');
    expect(deniedWorkflow.detail).toContain('approved bound');
    expect(await f.options.connection.read(statement`SELECT id FROM meter_reservations`)).toEqual([]);
  });
});
