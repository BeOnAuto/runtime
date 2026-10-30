import type {
  ListenerSubject,
  RecordStoreSubject,
  RunStoreSubject,
  TimerSubject,
  WatermarkSubject,
} from '@on.auto/workflow-engine/testing';
import { Effect, Function } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { listenersKeepingTheirOwnStops } from '../reaction-testing/own-stops.ts';
import { ledgerRunLogStore } from '../runs/ledger-run-store.ts';
import { ledgerRecordStore } from '../settlement/ledger-record-store.ts';
import { knownRuns } from '../testing/known-runs.ts';
import { sqlTimers } from '../timers/sql-timers.ts';

export const runKey = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherRunKey = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

export const startedAt = 1_790_845_200_000;

export function timerSubjectOn(database: HostDatabase): TimerSubject {
  const clock = { now: startedAt };
  const table = sqlTimers(database, Function.constVoid);
  return {
    timers: table.timers,
    run: { runId: runKey, attributes: {} },
    otherRun: { runId: otherRunKey, attributes: {} },
    now: () => clock.now,
    settle: () =>
      Effect.gen(function* () {
        clock.now += 3_600_000;
        const due = yield* table.due(clock.now, 100);
        yield* Effect.forEach(due, (timer) => table.fired(timer), { discard: true });
        return due.map(({ timerId }) => timerId);
      }),
  };
}

export function recordStoreSubjectOn(database: HostDatabase): RecordStoreSubject {
  const { settle, know } = knownRuns();
  return {
    recordStore: ledgerRecordStore(database, { settle, note: Effect.logWarning, now: Date.now }),
    run: { runId: runKey, attributes: {} },
    know: (runId) =>
      Effect.sync(() => {
        know(runId.slice(runId.lastIndexOf('/') + 1));
      }),
  };
}

export function watermarkSubjectOn(database: HostDatabase): WatermarkSubject {
  return { watermark: sqlWatermark(database), runStore: ledgerRunLogStore(database), runId: runKey };
}

export function runStoreSubjectOn(database: HostDatabase): RunStoreSubject {
  return { runStore: ledgerRunLogStore(database), runId: runKey };
}

export function listenerSubjectOn(database: HostDatabase): ListenerSubject {
  const attributes = { definition: { name: 'await-approval', version: 1 }, caller: { id: 'acme-admin' } };
  return {
    listeners: listenersKeepingTheirOwnStops(database),
    run: { runId: runKey, attributes },
    otherRun: { runId: otherRunKey, attributes },
  };
}
