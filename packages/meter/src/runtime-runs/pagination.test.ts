import { ok } from 'node:assert/strict';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { assertOfflineConservation } from '../offline-testing/fixture.ts';
import { dispatchRequest, runtimeFixture } from '../runtime-testing/fixture.ts';

describe('bounded recovery of pending Runtime runs', () => {
  it('visits later reservations even when a full page has no recorded endings', async () => {
    const f = await runtimeFixture();
    f.state.allocations = [
      { ...f.allocation, sources: f.allocation.sources.map((lot) => ({ ...lot, units: 101_000_000n })) },
    ];
    await f.meter.license.activate('activation-secret');
    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: 101 }, () => dispatchRequest({ runId: crypto.randomUUID() })),
        f.runs.admission.dispatch,
        { concurrency: 8 },
      ),
    );
    const first = await f.reconcile();
    expect(first).toMatchObject({ inspected: 100, pending: 100, settled: 0, failed: 0 });
    expect(first.afterId).toBeTypeOf('string');
    ok(first.afterId !== undefined);
    const second = await f.runs.reconcile({ reader: f.database.ledger, afterId: first.afterId });
    expect(second).toEqual({ inspected: 1, pending: 1, settled: 0, failed: 0, afterId: undefined });
    expect((await f.meter.capacity())?.counters).toMatchObject([{ committedUnits: 101_000_000n, reservedUnits: 0n }]);
    await assertOfflineConservation(f.options.connection);
  });
});
