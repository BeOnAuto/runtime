import type { Settlement } from '@on.auto/operations';
import type { Effect } from 'effect';

import type { DispatchFailed, OutputOrigin, RunContext } from '../dispatch/dispatch-watermark.ts';

export type SettleReceipt = 'recorded' | 'already_recorded' | 'settled_otherwise' | 'unknown_run';

export type TroublingReceipt = Extract<SettleReceipt, 'settled_otherwise' | 'unknown_run'>;

export interface SettleRequest {
  readonly runId: string;
  readonly settlement: Settlement;
}

export interface RunDue {
  readonly runId: string;
  readonly version: number;
  readonly nextDueAt: number | null;
}

export interface RecordStore {
  readonly settle: (
    request: SettleRequest,
    run: RunContext,
    origin: OutputOrigin,
  ) => Effect.Effect<SettleReceipt, DispatchFailed>;
  readonly noteDue: (due: RunDue, run: RunContext) => Effect.Effect<void, DispatchFailed>;
  readonly dueRuns: (before: number) => Effect.Effect<readonly string[]>;
}

export interface UnsettledReport {
  readonly run: RunContext;
  readonly receipt: TroublingReceipt;
}

export interface ReloadedReport {
  readonly runId: string;
  readonly snapshot: boolean;
  readonly events: number;
  readonly keptBytes: number;
}

export interface RunReporter {
  readonly unsettled: (report: UnsettledReport) => Effect.Effect<void>;
  readonly reloaded: (report: ReloadedReport) => Effect.Effect<void>;
}

export function isTroubling(receipt: SettleReceipt): receipt is TroublingReceipt {
  return receipt === 'settled_otherwise' || receipt === 'unknown_run';
}
