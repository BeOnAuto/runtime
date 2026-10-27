import { setImmediate } from 'node:timers/promises';

import type { ReconcileRunsRequest, SelfHostedMaintenance } from '@on.auto/meter';
import { Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { maintained, maintenanceFixture, reconciled, reconciliationPages } from '../metering-testing/maintenance.ts';

describe('owned Runtime metering maintenance', () => {
  it('advances beyond an unresolved page and returns to the start after the final page', async () => {
    const seen: ReconcileRunsRequest[] = [];
    const remaining = [{ ...reconciled, pending: 100, afterId: 'reservation:100' }, reconciled, reconciled];
    const fixture = maintenanceFixture(
      reconciliationPages((request) => {
        seen.push(request);
      }, remaining),
      () => Promise.resolve(maintained),
    );
    await fixture.perform(0);
    expect(await fixture.next(0)).toBe(1000);
    await fixture.perform(1000);
    expect(await fixture.next(1000)).toBe(31_000);
    await fixture.perform(31_000);
    expect(seen).toEqual([
      { reader: fixture.reader },
      { reader: fixture.reader, afterId: 'reservation:100' },
      { reader: fixture.reader },
    ]);
  });
});

describe('independent maintenance failure recovery', () => {
  it('keeps reporting independent from a failed journal read and waits for its completion', async () => {
    const started = Promise.withResolvers<true>();
    const reporting = Promise.withResolvers<SelfHostedMaintenance>();
    const fixture = maintenanceFixture(
      () => Promise.reject(new Error('private ledger failure')),
      () => {
        started.resolve(true);
        return reporting.promise;
      },
    );
    let completed = false;
    const running = fixture.perform(0).then(() => {
      completed = true;
      return true;
    });
    await started.promise;
    expect(completed).toBe(false);
    reporting.resolve(maintained);
    await running;
    expect(await fixture.next(0)).toBe(30_000);
  });

  it('retries an unexpected maintenance failure after awaiting reconciliation', async () => {
    const fixture = maintenanceFixture(
      () => Promise.resolve(reconciled),
      () => Promise.reject(new Error('private authority failure')),
    );
    await fixture.perform(0);
    expect(await fixture.next(0)).toBe(30_000);
  });
});

describe('stopping an in-flight maintenance cycle', () => {
  it('joins its underlying promise before interruption can release its database', async () => {
    const started = Promise.withResolvers<true>();
    const reporting = Promise.withResolvers<SelfHostedMaintenance>();
    const fixture = maintenanceFixture(
      () => Promise.resolve(reconciled),
      () => {
        started.resolve(true);
        return reporting.promise;
      },
    );
    const task = await fixture.item(0);
    const fiber = Effect.runFork(task.perform(0));
    await started.promise;
    let stopped = false;
    const stopping = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
      stopped = true;
      return true;
    });
    await setImmediate();
    expect(stopped).toBe(false);
    reporting.resolve(maintained);
    await stopping;
    expect(stopped).toBe(true);
  });
});
