import { ok } from 'node:assert/strict';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { selfHostedRuns } from '../index.ts';
import { assertOfflineConservation } from '../offline-testing/fixture.ts';
import { dispatchRequest, runtimeFixture } from '../runtime-testing/fixture.ts';
import { journalWith, runFacts } from '../runtime-testing/journal.ts';

describe('settlement follows the Runtime journal', () => {
  it('retains unknown and still-running work even after license expiry', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    await Effect.runPromise(f.runs.admission.dispatch(dispatchRequest()));
    f.pass(8 * 24 * 60 * 60 * 1000);
    expect(await f.reconcile()).toMatchObject({ pending: 1, settled: 0 });
    expect(await f.runs.reconcile({ reader: journalWith(runFacts({ finished: false })) })).toMatchObject({
      pending: 1,
      settled: 0,
    });
    expect(await f.runs.reconcile({ reader: journalWith(runFacts()) })).toMatchObject({ pending: 0, settled: 1 });
    expect((await f.meter.capacity())?.counters).toMatchObject([{ committedUnits: 1_000_000n }]);
    await assertOfflineConservation(f.options.connection);
  });

  it('retains mismatched endings and retries them when the matching journal becomes available', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    await Effect.runPromise(f.runs.admission.dispatch(dispatchRequest()));
    const original = dispatchRequest().definition;
    const journals = [
      runFacts({ definition: { ...original, type: 'recall' } }),
      runFacts({ definition: { ...original, name: 'other' } }),
      runFacts({ definition: { ...original, version: 2 } }),
      runFacts({ input: { value: 4 } }),
    ];
    const results = await Promise.all(journals.map((events) => f.runs.reconcile({ reader: journalWith(events) })));
    expect(results.map((result) => result.failed)).toEqual([1, 1, 1, 1]);
    expect(await f.runs.reconcile({ reader: journalWith(runFacts()) })).toMatchObject({ failed: 0, settled: 1 });
  });
});

describe('durable settlement retries', () => {
  it('retains a failed release and retries without a second charge or refund', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    await f.runtime.run();
    const failed = selfHostedRuns({
      ...f.runOptions,
      meter: {
        ...f.meter,
        accounting: {
          ...f.meter.accounting,
          release: () => Promise.reject(new Error('release unavailable')),
        },
      },
    });
    expect(await failed.reconcile({ reader: f.database.ledger })).toMatchObject({ failed: 1, settled: 0 });
    expect(await f.reconcile()).toMatchObject({ failed: 0, settled: 1 });
    expect(await f.reconcile()).toMatchObject({ inspected: 0 });
    await assertOfflineConservation(f.options.connection);
  });

  it('accepts settlement by another process between the pending scan and reservation read', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    await f.runtime.run();
    const racing = selfHostedRuns({
      ...f.runOptions,
      meter: {
        ...f.meter,
        accounting: {
          ...f.meter.accounting,
          reservation: async (id) => {
            await f.reconcile();
            return f.meter.accounting.reservation(id);
          },
        },
      },
    });
    expect(await racing.reconcile({ reader: f.database.ledger })).toMatchObject({ settled: 1, failed: 0 });
    expect(await f.reconcile()).toMatchObject({ inspected: 0 });
  });
});

describe('incomplete settlement evidence', () => {
  it('counts a missing reservation as failed and retains it for recovery', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    await f.runtime.run();
    const missing = selfHostedRuns({
      ...f.runOptions,
      meter: {
        ...f.meter,
        accounting: {
          ...f.meter.accounting,
          reservation: () => Effect.runPromise(Effect.undefined),
        },
      },
    });
    expect(await missing.reconcile({ reader: f.database.ledger })).toMatchObject({ failed: 1, settled: 0 });
    expect(await f.reconcile()).toMatchObject({ failed: 0, settled: 1 });
  });

  it.each(['foreign', 'other:acme:alpha', 'runtime:invalid:bad:scope', 'runtime:bad/org:alpha'])(
    'does not release work with an unrelated or malformed namespace %s',
    async (playbookId) => {
      const f = await runtimeFixture();
      await f.meter.license.activate('activation-secret');
      await f.runtime.run();
      const changed = selfHostedRuns({
        ...f.runOptions,
        meter: {
          ...f.meter,
          accounting: {
            ...f.meter.accounting,
            reservation: async (id) => {
              const reservation = await f.meter.accounting.reservation(id);
              ok(reservation !== undefined);
              return {
                ...reservation,
                context: { ...reservation.context, run: { ...reservation.context.run, playbookId } },
              };
            },
          },
        },
      });
      const result = await changed.reconcile({ reader: f.database.ledger });
      expect(result.settled).toBe(0);
      expect(result.failed + result.pending).toBe(1);
      expect(await f.reconcile()).toMatchObject({ settled: 1, failed: 0 });
    },
  );
});
