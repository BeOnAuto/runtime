import type { SettleRun } from '@on.auto/definitions';
import { Conflict, type Lineage, type Settlement } from '@on.auto/operations';
import { Effect } from 'effect';

import type { HostNote, HostReports } from '../host/host-reports.ts';
import { knownRuns } from './known-runs.ts';

export interface RecordingReports {
  readonly reports: HostReports;
  readonly troubles: () => readonly string[];
  readonly notes: () => readonly HostNote[];
}

export interface RecordingSettlements {
  readonly settle: SettleRun;
  readonly settlements: () => ReadonlyMap<string, Settlement>;
  readonly lineages: () => ReadonlyMap<string, Lineage | undefined>;
  readonly attempts: () => number;
  readonly know: (runId: string) => void;
}

const ledgerUnreachable = new Conflict({ detail: 'The ledger cannot be reached' });

export function recordingReports(): RecordingReports {
  const troubles: string[] = [];
  const notes: HostNote[] = [];
  const noted = (line: unknown): void => {
    troubles.push(String(line));
  };
  return {
    reports: {
      unsettled: ({ runId, receipt }) =>
        Effect.sync(() => {
          noted(`${runId} ${receipt}`);
        }),
      trouble: (what) =>
        Effect.sync(() => {
          noted(what);
        }),
      note: (note) =>
        Effect.sync(() => {
          notes.push(note);
        }),
    },
    troubles: () => troubles,
    notes: () => notes,
  };
}

export function recordingSettlements(ledgerDown: () => boolean): RecordingSettlements {
  const settled = new Map<string, Settlement>();
  const lineages = new Map<string, Lineage | undefined>();
  const counts = { attempts: 0 };
  const { settle, know } = knownRuns();
  return {
    settle: (address, settlement, lineage) =>
      Effect.suspend(() => {
        counts.attempts += 1;
        return ledgerDown() ? Effect.fail(ledgerUnreachable) : settle(address, settlement);
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            settled.set(address.id, settlement);
            lineages.set(address.id, lineage);
          }),
        ),
      ),
    settlements: () => settled,
    lineages: () => lineages,
    attempts: () => counts.attempts,
    know,
  };
}
