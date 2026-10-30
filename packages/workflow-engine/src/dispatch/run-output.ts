import { SettlementSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import { CallKeySchema } from '../executor/call-key.ts';
import { InstantSchema } from '../machine/instant.ts';
import { TimerPurposeSchema } from '../timers/timer-id.ts';

const RunIdSchema = Schema.NonEmptyString;

const ArmTimerSchema = Schema.Struct({
  kind: Schema.Literal('arm_timer'),
  runId: RunIdSchema,
  timerId: Schema.NonEmptyString,
  dueAt: InstantSchema,
  purpose: TimerPurposeSchema,
  label: Schema.optionalKey(Schema.String),
});

const CancelTimerSchema = Schema.Struct({
  kind: Schema.Literal('cancel_timer'),
  runId: RunIdSchema,
  timerId: Schema.NonEmptyString,
});

const StartCallSchema = Schema.Struct({
  kind: Schema.Literal('start_call'),
  key: CallKeySchema,
  function: Schema.NonEmptyString,
  arguments: Schema.Json,
  longestMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

export const CancelReasonSchema = Schema.Literals(['deadline', 'parent_ended']);

const CancelCallSchema = Schema.Struct({
  kind: Schema.Literal('cancel_call'),
  key: CallKeySchema,
  reason: Schema.optionalKey(CancelReasonSchema),
});

const ArmListenerSchema = Schema.Struct({
  kind: Schema.Literal('arm_listener'),
  key: CallKeySchema,
  filters: Schema.Array(Schema.JsonObject),
});

const CancelListenerSchema = Schema.Struct({
  kind: Schema.Literal('cancel_listener'),
  key: CallKeySchema,
});

const EmitEventSchema = Schema.Struct({
  kind: Schema.Literal('emit_event'),
  key: CallKeySchema,
  event: Schema.JsonObject,
});

const SettleSchema = Schema.Struct({
  kind: Schema.Literal('settle'),
  runId: RunIdSchema,
  settlement: SettlementSchema,
});

export const RunOutputSchema = Schema.Union([
  ArmTimerSchema,
  CancelTimerSchema,
  StartCallSchema,
  CancelCallSchema,
  ArmListenerSchema,
  CancelListenerSchema,
  EmitEventSchema,
  SettleSchema,
]);

export type ArmTimer = typeof ArmTimerSchema.Type;

export type CancelTimer = typeof CancelTimerSchema.Type;

export type StartCall = typeof StartCallSchema.Type;

export type CancelCall = typeof CancelCallSchema.Type;

export type CancelReason = typeof CancelReasonSchema.Type;

export type ArmListener = typeof ArmListenerSchema.Type;

export type CancelListener = typeof CancelListenerSchema.Type;

export type EmitEvent = typeof EmitEventSchema.Type;

export type Settle = typeof SettleSchema.Type;

export type RunOutput = typeof RunOutputSchema.Type;
