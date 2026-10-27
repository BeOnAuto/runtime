import { ok } from 'node:assert/strict';

import type {
  ReconciledRuns,
  ReconcileRunsRequest,
  RuntimeRuns,
  SelfHostedMaintenance,
  SelfHostedMeter,
} from '@on.auto/meter';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { meterMaintenance } from '../metering/maintenance.ts';

export const reconciled: ReconciledRuns = { inspected: 0, settled: 0, pending: 0, failed: 0, afterId: undefined };
export const maintained: SelfHostedMaintenance = {
  license: { status: 'idle', retryInMilliseconds: 60_000 },
  reporting: { status: 'idle', retryInMilliseconds: 60_000 },
  retryInMilliseconds: 60_000,
};

export function reconciliationPages(
  record: (request: ReconcileRunsRequest) => void,
  given: readonly ReconciledRuns[],
): RuntimeRuns['reconcile'] {
  const remaining = [...given];
  return (request) => {
    record(request);
    const next = remaining.shift();
    ok(next !== undefined);
    return Promise.resolve(next);
  };
}

export function maintenanceFixture(reconcile: RuntimeRuns['reconcile'], maintain: SelfHostedMeter['maintain']) {
  const reader = memoryLedger().service;
  const work = meterMaintenance({ maintain }, { reconcile }, reader);
  async function item(now: number) {
    const [due] = await Effect.runPromise(work.due(now, 1, true));
    ok(due !== undefined);
    return due;
  }
  return {
    reader,
    item,
    perform: async (now: number) => Effect.runPromise((await item(now)).perform(now)),
    next: (now: number) => Effect.runPromise(work.nextDueAt(now)),
  };
}
