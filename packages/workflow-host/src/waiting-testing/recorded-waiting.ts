import type { CancelReceipt, CancelRequest, RunStreamAddress, RunEnding } from '@on.auto/definitions';
import type { CallResult, Lineage } from '@on.auto/operations';
import { Effect } from 'effect';

import type { WaitingOptions } from '../waiting/waiting-options.ts';

interface RecordedCancel {
  readonly run: RunStreamAddress;
  readonly request: CancelRequest;
  readonly lineage: Lineage;
}

export interface RecordedWaiting {
  readonly options: WaitingOptions;
  readonly cancels: () => readonly RecordedCancel[];
  readonly deferredCancels: () => readonly RecordedCancel[];
}

export function resultOfEnding(ending: RunEnding): CallResult {
  if (ending.type === 'run_succeeded') {
    return { status: 'succeeded', output: ending.data.output };
  }
  return ending.type === 'run_rejected'
    ? { status: 'rejected', reason: ending.data.rejection.reason, detail: ending.data.rejection.detail }
    : { status: 'failed', detail: 'The run broke down' };
}

export function recordedWaiting(receipt: CancelReceipt = 'requested'): RecordedWaiting {
  const cancels: RecordedCancel[] = [];
  const deferredCancels: RecordedCancel[] = [];
  return {
    options: {
      resultOf: resultOfEnding,
      cancel: (run, request, lineage) =>
        Effect.sync(() => {
          cancels.push({ run, request, lineage });
          return receipt;
        }),
      cancelDeferred: (run, request, lineage) =>
        Effect.sync(() => {
          deferredCancels.push({ run, request, lineage });
        }),
    },
    cancels: () => cancels,
    deferredCancels: () => deferredCancels,
  };
}
