import type { Settlement } from '@on.auto/operations';
import { Effect } from 'effect';

import { DispatchFailed, type DispatchWatermark } from '../dispatch/dispatch-watermark.ts';
import { sameJson } from '../machine/same-json.ts';
import type { RecordStore, RunDue, RunReporter, SettleReceipt, UnsettledReport } from '../settlement/record-store.ts';
import type { Faults } from './memory-timers.ts';
import type { MemoryRunStore } from './run-store.ts';

export interface MemoryRecordStore extends RecordStore {
  readonly known: (runId: string) => void;
  readonly settlementOf: (runId: string) => Settlement | undefined;
}

export interface MemoryReporter extends RunReporter {
  readonly reports: () => readonly UnsettledReport[];
}

export function memoryRecordStore(faults: Faults): MemoryRecordStore {
  const known = new Set<string>();
  const settled = new Map<string, Settlement>();
  const dues = new Map<string, RunDue>();
  const recorded = (runId: string, settlement: Settlement): SettleReceipt => {
    const earlier = settled.get(runId);
    if (!known.has(runId)) {
      return 'unknown_run';
    }
    if (earlier === undefined) {
      settled.set(runId, settlement);
      return 'recorded';
    }
    return sameJson(earlier, settlement) ? 'already_recorded' : 'settled_otherwise';
  };
  return {
    settle: (request) =>
      faults.attempt({ kind: 'settle', ...request }, () => recorded(request.runId, request.settlement)),
    noteDue: (due) =>
      Effect.suspend(() => {
        if (faults.fails('note_due')) {
          return Effect.fail(
            new DispatchFailed({ output: 'note_due', detail: 'The record store was told to fail once' }),
          );
        }
        const noted = dues.get(due.runId);
        if (noted === undefined || noted.version <= due.version) {
          dues.set(due.runId, due);
        }
        return Effect.void;
      }),
    dueRuns: (before) =>
      Effect.sync(() =>
        [...dues.values()]
          .filter((due) => !settled.has(due.runId))
          .filter(({ nextDueAt }) => nextDueAt !== null && nextDueAt < before)
          .map(({ runId }) => runId),
      ),
    known: (runId) => {
      known.add(runId);
    },
    settlementOf: (runId) => settled.get(runId),
  };
}

export function memoryReporter(): MemoryReporter {
  const reports: UnsettledReport[] = [];
  return {
    unsettled: (report) =>
      Effect.sync(() => {
        reports.push(report);
      }),
    reports: () => reports,
  };
}

interface Handouts {
  readonly takenAt: (runId: string) => number;
  readonly handOut: (runIds: readonly string[]) => readonly string[];
}

function handoutsOf(): Handouts {
  const taken = new Map<string, number>();
  const clock = { now: 0 };
  return {
    takenAt: (runId) => taken.get(runId) ?? 0,
    handOut: (runIds) => {
      clock.now += 1;
      for (const runId of runIds) {
        taken.set(runId, clock.now);
      }
      return runIds;
    },
  };
}

export function memoryWatermark(runStore: Pick<MemoryRunStore, 'versions'>): DispatchWatermark {
  const marks = new Map<string, number>();
  const handouts = handoutsOf();
  const markOf = (runId: string): number => marks.get(runId) ?? 0;
  return {
    read: (runId) => Effect.sync(() => markOf(runId)),
    advance: (runId, through) =>
      Effect.sync(() => {
        marks.set(runId, Math.max(markOf(runId), through));
      }),
    behindRuns: (limit) =>
      Effect.sync(() =>
        handouts.handOut(
          [...runStore.versions()]
            .filter(([runId, version]: readonly [string, number]) => markOf(runId) < version)
            .map(([runId]: readonly [string, number]) => runId)
            .toSorted((first, second) => handouts.takenAt(first) - handouts.takenAt(second))
            .slice(0, limit),
        ),
      ),
  };
}
