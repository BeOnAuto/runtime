import { Schema } from 'effect';

import { callKeyText } from '../executor/call-key.ts';
import { clampedAt, InstantSchema } from './instant.ts';
import type { RunInput } from './run-input.ts';
import type { RunState } from './run-state.ts';

const keyed = {
  key: Schema.String,
  at: InstantSchema,
};

export const InputReceiptSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('started'), ...keyed }),
  Schema.Struct({ kind: Schema.Literal('timer_fired'), ...keyed }),
  Schema.Struct({
    kind: Schema.Literal('call_answered'),
    ...keyed,
    status: Schema.Literals(['succeeded', 'rejected', 'failed', 'unreachable']),
    rejection: Schema.optionalKey(
      Schema.Struct({ kind: Schema.optionalKey(Schema.String), because: Schema.optionalKey(Schema.String) }),
    ),
  }),
  Schema.Struct({ kind: Schema.Literal('event_received'), ...keyed, eventType: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('event_offered'), ...keyed, eventType: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('cancel_requested'),
    ...keyed,
    cancel: Schema.optionalKey(
      Schema.Struct({ by: Schema.String, kind: Schema.Literals(['requested', 'deadline', 'parent_ended']) }),
    ),
  }),
]);

export type InputReceipt = typeof InputReceiptSchema.Type;

export function inputTimeOf(state: RunState, input: RunInput): number {
  const at = clampedAt(state.lastInputAt, input.at);
  const armed =
    input.kind === 'timer_fired' && Object.hasOwn(state.timers.armed, input.timerId)
      ? state.timers.armed[input.timerId]
      : undefined;
  return armed === undefined ? at : Math.max(at, armed.dueAt);
}

type Answer = Extract<RunInput, { readonly kind: 'call_answered' }>['result'];

function rejectionOf(result: Answer): Pick<Extract<InputReceipt, { readonly kind: 'call_answered' }>, 'rejection'> {
  if (result.status !== 'rejected') {
    return {};
  }
  const { kind, because } = result;
  const rejection = { ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
  return Object.keys(rejection).length === 0 ? {} : { rejection };
}

export function receiptOf(input: RunInput, at: number): InputReceipt {
  if (input.kind === 'timer_fired') {
    return { kind: input.kind, key: input.timerId, at };
  }
  if (input.kind === 'call_answered') {
    return {
      kind: input.kind,
      key: callKeyText(input.key),
      at,
      status: input.result.status,
      ...rejectionOf(input.result),
    };
  }
  if (input.kind === 'event_received') {
    return { kind: input.kind, key: input.event.id, at, eventType: input.event.type };
  }
  if (input.kind === 'event_offered') {
    return { kind: input.kind, key: input.key, at, eventType: input.event.type };
  }
  if (input.kind === 'cancel_requested') {
    const { by, kind } = input.cancel;
    return { kind: input.kind, key: input.runId, at, cancel: { by, kind } };
  }
  return { kind: input.kind, key: input.runId, at };
}
