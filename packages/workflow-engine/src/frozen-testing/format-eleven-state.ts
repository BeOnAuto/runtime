import { Schema } from 'effect';

import { CallKeySchema } from '../run-log/formats/format-seven.ts';
import { StepCauseSchema } from '../run-log/formats/format-six.ts';
import { InstantSchema, ReceivedEventSchema, TimerPurposeSchema } from '../run-log/formats/format-two.ts';

const IssueSchema = Schema.Struct({ detail: Schema.String, pointer: Schema.String });

const ErrorCauseSchema = Schema.Struct({
  status: Schema.Literals(['rejected', 'failed', 'unreachable', 'timed_out']),
  run_id: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
});

const DslErrorSchema = Schema.Struct({
  type: Schema.String,
  status: Schema.Int,
  instance: Schema.String,
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
  issues: Schema.optionalKey(Schema.Array(IssueSchema)),
  cause: Schema.optionalKey(ErrorCauseSchema),
});

const ValueIdSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const VariablesSchema = Schema.Record(Schema.String, ValueIdSchema);

const TaskFrameReference = Schema.suspend((): Schema.Codec<unknown, unknown> => TaskFrameSchema);

const CountSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const AdmissionRefusalSchema = Schema.Struct({
  reason: Schema.String,
  detail: Schema.String,
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
  issues: Schema.optionalKey(Schema.Array(IssueSchema)),
  resolve_at: Schema.optionalKey(Schema.String),
  lifts_at: Schema.optionalKey(Schema.String),
  limited_because: Schema.optionalKey(Schema.String),
});

const RefusedCallsSchema = Schema.Struct({
  since: InstantSchema,
  refusals: CountSchema,
  waited: CountSchema,
  refusal: Schema.optionalKey(AdmissionRefusalSchema),
});

const ListCursorSchema = Schema.Struct({
  pointer: Schema.String,
  position: Schema.Int,
  data: ValueIdSchema,
  variables: VariablesSchema,
  current: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('running'), task: TaskFrameReference }),
    Schema.Struct({ kind: Schema.Literal('yielding'), timer: Schema.String, after: StepCauseSchema }),
  ]),
});

const BranchSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal('yielding'), timer: Schema.String }),
  Schema.Struct({ state: Schema.Literal('running'), task: TaskFrameReference }),
  Schema.Struct({ state: Schema.Literal('finished'), output: ValueIdSchema, flow: Schema.String }),
  Schema.Struct({ state: Schema.Literal('failed'), error: DslErrorSchema, order: Schema.Int }),
]);

const TryPhaseSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('trying'), list: ListCursorSchema, attemptLimit: Schema.NullOr(Schema.String) }),
  Schema.Struct({
    kind: Schema.Literal('backing_off'),
    timer: Schema.String,
    error: DslErrorSchema,
    failed: StepCauseSchema,
  }),
  Schema.Struct({ kind: Schema.Literal('recovering'), list: ListCursorSchema }),
]);

const FrameBodySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('list'), list: ListCursorSchema }),
  Schema.Struct({
    kind: Schema.Literal('for'),
    items: ValueIdSchema,
    index: Schema.Int,
    data: ValueIdSchema,
    list: ListCursorSchema,
  }),
  Schema.Struct({ kind: Schema.Literal('fork'), compete: Schema.Boolean, branches: Schema.Array(BranchSchema) }),
  Schema.Struct({ kind: Schema.Literal('try'), attempt: Schema.Int, startedAt: InstantSchema, phase: TryPhaseSchema }),
  Schema.Struct({ kind: Schema.Literal('wait'), timer: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('call'),
    key: CallKeySchema,
    function: Schema.NonEmptyString,
    arguments: ValueIdSchema,
    label: Schema.String,
    deadline: Schema.String,
    refused: Schema.optionalKey(RefusedCallsSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal('admission'),
    function: Schema.NonEmptyString,
    arguments: ValueIdSchema,
    label: Schema.String,
    timer: Schema.String,
    refused: RefusedCallsSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('listen'),
    consumed: Schema.Array(Schema.NullOr(ValueIdSchema)),
    waited: Schema.Int,
  }),
]);

const TaskFrameSchema = Schema.Struct({
  reference: Schema.String,
  run: Schema.Int,
  startedAt: InstantSchema,
  context: ValueIdSchema,
  rawInput: ValueIdSchema,
  input: ValueIdSchema,
  variables: VariablesSchema,
  timeout: Schema.NullOr(Schema.String),
  body: FrameBodySchema,
});

const PositiveMillisecondsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const RunLimitsSchema = Schema.Struct({
  mostDurationMs: PositiveMillisecondsSchema,
  longestCallMs: PositiveMillisecondsSchema,
  longestCallMsByTask: Schema.optionalKey(Schema.Record(Schema.String, PositiveMillisecondsSchema)),
});

const CancelOrderSchema = Schema.Struct({
  by: Schema.NonEmptyString,
  kind: Schema.Literals(['requested', 'deadline', 'parent_ended']),
  reason: Schema.String,
});

const RunOutcomeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('completed'), output: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal('raised'), error: DslErrorSchema }),
  Schema.Struct({ kind: Schema.Literal('cancelled'), cancel: CancelOrderSchema }),
  Schema.Struct({ kind: Schema.Literal('broken'), reason: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('oversized'), bytes: Schema.Int, most: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal('overran'), milliseconds: Schema.Int }),
]);

export const StateOfFormatElevenSchema = Schema.Struct({
  runId: Schema.String,
  status: Schema.Literals(['new', 'running', 'ended']),
  workflow: Schema.NullOr(Schema.Struct({ document: Schema.JsonObject, input: ValueIdSchema })),
  attributes: Schema.JsonObject,
  limits: RunLimitsSchema,
  startedAt: InstantSchema,
  lastInputAt: InstantSchema,
  inputs: Schema.Int,
  random: Schema.Struct({ seed: Schema.Int, draws: Schema.Int }),
  runs: Schema.Record(Schema.String, Schema.Int),
  timers: Schema.Struct({
    next: Schema.Int,
    armed: Schema.Record(
      Schema.String,
      Schema.Struct({
        purpose: TimerPurposeSchema,
        reference: Schema.String,
        armedAt: InstantSchema,
        dueAt: InstantSchema,
      }),
    ),
  }),
  calls: Schema.Record(Schema.String, CallKeySchema),
  listeners: Schema.Record(Schema.String, CallKeySchema),
  emitted: Schema.Struct({ count: Schema.Int, bytes: Schema.Int }),
  inbox: Schema.Struct({
    waiting: Schema.Array(Schema.Struct({ event: ReceivedEventSchema, bytes: Schema.Int })),
    waitingBytes: Schema.Int,
    receivedIds: Schema.Array(Schema.String),
    offeredIds: Schema.Array(Schema.String),
    received: Schema.Int,
    receivedBytes: Schema.Int,
  }),
  heldBytes: Schema.Int,
  historyBytes: Schema.Int,
  stepsWithoutWaiting: Schema.Int,
  cancelRequested: Schema.Boolean,
  machine: Schema.Struct({
    values: Schema.Record(Schema.String, Schema.Struct({ value: Schema.Json, bytes: Schema.Int })),
    nextValue: ValueIdSchema,
    context: ValueIdSchema,
    root: Schema.NullOr(TaskFrameSchema),
  }),
  outcome: Schema.NullOr(RunOutcomeSchema),
});
