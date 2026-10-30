import type { CancelRun, RunEnding, SettleCancelled } from '@on.auto/definitions';
import type { CallResult } from '@on.auto/operations';

export interface WaitingOptions {
  readonly resultOf: (ending: RunEnding) => CallResult;
  readonly cancel: CancelRun;
  readonly cancelDeferred: SettleCancelled;
}

export const mostOpenCallsOfATree = 1000;
