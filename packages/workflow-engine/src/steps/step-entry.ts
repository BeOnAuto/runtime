import { Schema } from 'effect';

import { InstantSchema } from '../machine/instant.ts';

export const mostNameBytes = 256;

export const mostTitleBytes = 1024;

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

export type StepOutcome = typeof StepOutcomeSchema.Type;

const WaitsForSchema = Schema.Literals(['call', 'timer', 'event', 'admission']);

export type WaitsFor = typeof WaitsForSchema.Type;

const StepRefusalSchema = Schema.Struct({
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
  detail: Schema.String,
  resolve_at: Schema.optionalKey(Schema.String),
  retry_at: InstantSchema,
  until: InstantSchema,
});

export type StepRefusal = typeof StepRefusalSchema.Type;

const StepKeySchema = Schema.Struct({
  reference: Schema.String,
  run: RunCountSchema,
  outcome: StepOutcomeSchema,
  times: RunCountSchema,
});

export type StepKey = typeof StepKeySchema.Type;

export const StepCauseSchema = Schema.Union([Schema.Literal('input'), StepKeySchema]);

export type StepCause = typeof StepCauseSchema.Type;

export const StepSchema = Schema.Struct({
  reference: Schema.String,
  run: RunCountSchema,
  outcome: StepOutcomeSchema,
  name: Schema.String,
  times: RunCountSchema,
  caused_by: StepCauseSchema,
  error: Schema.optionalKey(Schema.Struct({ type: Schema.String, title: Schema.optionalKey(Schema.String) })),
  waits_for: Schema.optionalKey(WaitsForSchema),
  child: Schema.optionalKey(Schema.String),
  refusal: Schema.optionalKey(StepRefusalSchema),
});

export type Step = typeof StepSchema.Type;

export const EarlierStepSchema = Schema.Struct({
  reference: Schema.String,
  run: RunCountSchema,
  outcome: StepOutcomeSchema,
});

export type EarlierStep = typeof EarlierStepSchema.Type;

export const ResumedSchema = Schema.Struct({ reference: Schema.String, run: RunCountSchema, times: RunCountSchema });

export type Resumed = typeof ResumedSchema.Type;

export function keyOf({ reference, run, outcome, times }: Step): StepKey {
  return { reference, run, outcome, times };
}

export function isRecordedStep(step: Step | EarlierStep): step is Step {
  return 'times' in step;
}
