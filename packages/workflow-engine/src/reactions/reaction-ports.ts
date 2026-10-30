import type { Effect } from 'effect';

import type { DispatchFailed, OutputOrigin, RunContext } from '../dispatch/dispatch-watermark.ts';
import type { ArmListener, CancelListener, EmitEvent } from '../dispatch/run-output.ts';

export type ListenerArmReceipt = 'armed' | 'already_armed' | 'refused';

export type ListenerCancelReceipt = 'cancelled' | 'not_armed';

export type EmitReceipt = 'recorded' | 'already_recorded' | 'refused';

export interface Listeners {
  readonly arm: (
    listener: ArmListener,
    run: RunContext,
    origin: OutputOrigin,
  ) => Effect.Effect<ListenerArmReceipt, DispatchFailed>;
  readonly cancel: (listener: CancelListener, run: RunContext) => Effect.Effect<ListenerCancelReceipt, DispatchFailed>;
}

export interface Emitter {
  readonly emit: (
    emission: EmitEvent,
    run: RunContext,
    origin: OutputOrigin,
  ) => Effect.Effect<EmitReceipt, DispatchFailed>;
}
