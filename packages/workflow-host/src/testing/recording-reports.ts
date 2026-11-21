import type { SettleRun } from '@on.auto/definitions';
import { Conflict, type Lineage, type Settlement } from '@on.auto/operations';
import { Effect } from 'effect';

import type { HostNote, HostReports } from '../host/host-reports.ts';
import { knownRuns } from './known-runs.ts';
import { signals, type Signals } from './signals.ts';

export { restingOn, signals, type Signals } from './signals.ts';

export interface RecordingReports {
  readonly reports: HostReports;
  readonly troubles: () => readonly string[];
  readonly notes: () => readonly HostNote[];
  /** Answers once a read of what was reported holds, read again after each report. */
  readonly when: Signals['when'];
}

export interface RecordingSettlements {
  readonly settle: SettleRun;
  readonly settlements: () => ReadonlyMap<string, Settlement>;
  readonly lineages: () => ReadonlyMap<string, Lineage | undefined>;
  readonly attempts: () => number;
  readonly know: (runId: string) => void;
  /** Answers once a read of the settlements holds, read again after each attempt. */
  readonly when: Signals['when'];
}

const ledgerUnreachable = new Conflict({ detail: 'The ledger cannot be reached' });

export function recordingReports(seen: Signals = signals()): RecordingReports {
  const troubles: string[] = [];
  const notes: HostNote[] = [];
  const noted = (line: unknown): void => {
    troubles.push(String(line));
    seen.changed();
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
          seen.changed();
        }),
    },
    troubles: () => troubles,
    notes: () => notes,
    when: seen.when,
  };
}

export function recordingSettlements(ledgerDown: () => boolean, seen: Signals = signals()): RecordingSettlements {
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
        Effect.ensuring(Effect.sync(seen.changed)),
      ),
    settlements: () => settled,
    lineages: () => lineages,
    attempts: () => counts.attempts,
    know,
    when: seen.when,
  };
}
