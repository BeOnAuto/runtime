import type { Effect } from 'effect';

import type { DispatchFailed, OutputOrigin, RunContext } from '../dispatch/dispatch-watermark.ts';
import type { CancelCall, StartCall } from '../dispatch/run-output.ts';

export type StartReceipt = 'started' | 'started_again' | 'running' | 'answered_again' | 'refused_after_cancel';

export type CallCancelReceipt = 'cancelled' | 'already_answered' | 'tombstoned';

export interface Executor {
  readonly start: (
    call: StartCall,
    run: RunContext,
    origin: OutputOrigin,
  ) => Effect.Effect<StartReceipt, DispatchFailed>;
  readonly cancel: (
    call: CancelCall,
    run: RunContext,
    origin: OutputOrigin,
  ) => Effect.Effect<CallCancelReceipt, DispatchFailed>;
}
