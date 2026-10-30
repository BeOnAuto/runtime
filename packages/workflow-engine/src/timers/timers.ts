import type { Effect } from 'effect';

import type { DispatchFailed, OutputOrigin, RunContext } from '../dispatch/dispatch-watermark.ts';
import type { ArmTimer, CancelTimer } from '../dispatch/run-output.ts';

export type ArmReceipt = 'armed' | 'already_armed' | 'refused_after_cancel';

export type TimerCancelReceipt = 'cancelled' | 'already_fired' | 'tombstoned';

export interface Timers {
  readonly arm: (timer: ArmTimer, run: RunContext, origin: OutputOrigin) => Effect.Effect<ArmReceipt, DispatchFailed>;
  readonly cancel: (timer: CancelTimer, run: RunContext) => Effect.Effect<TimerCancelReceipt, DispatchFailed>;
  readonly sweep: (run: RunContext, armed: readonly ArmTimer[]) => Effect.Effect<number, DispatchFailed>;
}
