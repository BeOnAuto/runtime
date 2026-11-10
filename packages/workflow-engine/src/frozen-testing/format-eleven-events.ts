import { SettlementSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import { CallKeySchema } from '../run-log/formats/format-seven.ts';
import { InstantSchema, TimerPurposeSchema } from '../run-log/formats/format-two.ts';

const keyed = { key: Schema.String, at: InstantSchema };

const ReceiptSchema = Schema.Union([
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

const RunCountSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const StepOutcomeSchema = Schema.Literals([
  'started',
  'skipped',
  'waiting',
  'completed',
  'raised',
  'timed_out',
  'cancelled',
]);

const StepCauseSchema = Schema.Union([
  Schema.Literal('input'),
  Schema.Struct({ reference: Schema.String, run: RunCountSchema, outcome: StepOutcomeSchema, times: RunCountSchema }),
]);

const StepRefusalSchema = Schema.Struct({
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
  detail: Schema.String,
  resolve_at: Schema.optionalKey(Schema.String),
  lifts_at: Schema.optionalKey(Schema.String),
  limited_because: Schema.optionalKey(Schema.String),
  retry_at: InstantSchema,
  until: InstantSchema,
});

const StepSchema = Schema.Struct({
  reference: Schema.String,
  run: RunCountSchema,
  outcome: StepOutcomeSchema,
  name: Schema.String,
  times: RunCountSchema,
  caused_by: StepCauseSchema,
  error: Schema.optionalKey(Schema.Struct({ type: Schema.String, title: Schema.optionalKey(Schema.String) })),
  waits_for: Schema.optionalKey(Schema.Literals(['call', 'timer', 'event', 'admission'])),
  child: Schema.optionalKey(Schema.String),
  refusal: Schema.optionalKey(StepRefusalSchema),
});

const EarlierStepSchema = Schema.Struct({ reference: Schema.String, run: RunCountSchema, outcome: StepOutcomeSchema });

const ResumedSchema = Schema.Struct({ reference: Schema.String, run: RunCountSchema, times: RunCountSchema });

const PatchOperationSchema = Schema.Union([
  Schema.Struct({ op: Schema.Literal('add'), path: Schema.String, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal('replace'), path: Schema.String, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal('remove'), path: Schema.String }),
]);

const RunIdSchema = Schema.NonEmptyString;

const OutputSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('arm_timer'),
    runId: RunIdSchema,
    timerId: Schema.NonEmptyString,
    dueAt: InstantSchema,
    purpose: TimerPurposeSchema,
    label: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal('cancel_timer'), runId: RunIdSchema, timerId: Schema.NonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal('start_call'),
    key: CallKeySchema,
    function: Schema.NonEmptyString,
    arguments: Schema.Json,
    longestMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
  Schema.Struct({
    kind: Schema.Literal('cancel_call'),
    key: CallKeySchema,
    reason: Schema.optionalKey(Schema.Literals(['deadline', 'parent_ended'])),
  }),
  Schema.Struct({ kind: Schema.Literal('arm_listener'), key: CallKeySchema, filters: Schema.Array(Schema.JsonObject) }),
  Schema.Struct({ kind: Schema.Literal('cancel_listener'), key: CallKeySchema }),
  Schema.Struct({ kind: Schema.Literal('emit_event'), key: CallKeySchema, event: Schema.JsonObject }),
  Schema.Struct({ kind: Schema.Literal('settle'), runId: RunIdSchema, settlement: SettlementSchema }),
]);

export const EventOfFormatElevenSchema = Schema.Struct({
  type: Schema.Literal('input_applied'),
  format: Schema.Literal(11),
  receipt: ReceiptSchema,
  steps: Schema.Array(Schema.Union([StepSchema, EarlierStepSchema])),
  resumed: Schema.optionalKey(Schema.NullOr(ResumedSchema)),
  patch: Schema.Array(PatchOperationSchema),
  outputs: Schema.Array(OutputSchema),
});
