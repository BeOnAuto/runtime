import type { CancelRun, RunEnding, SettleCancelled } from '@on.auto/definitions';
import type { CallAnsweredResult } from '@on.auto/workflow-engine';

export interface WaitingOptions {
  readonly resultOf: (ending: RunEnding) => CallAnsweredResult;
  readonly cancel: CancelRun;
  readonly cancelDeferred: SettleCancelled;
}

export const mostOpenCallsOfATree = 1000;
