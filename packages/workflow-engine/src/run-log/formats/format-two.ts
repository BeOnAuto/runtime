import { Schema } from 'effect';

import type { OlderFormat } from '../state-format.ts';

export const InstantSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const CallKeySchema = Schema.Struct({
  executionId: Schema.NonEmptyString,
  reference: Schema.String,
  run: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

export const ReceivedEventSchema = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
    type: Schema.NonEmptyString,
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);

export const RunLimitsSchema = Schema.Struct({
  mostDurationMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  longestCallMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

export const TimerPurposeSchema = Schema.Literals([
  'wait',
  'timeout',
  'retry_delay',
  'attempt_limit',
  'deadline',
  'call_deadline',
  'yield',
]);

export const DslErrorSchema = Schema.Struct({
  type: Schema.String,
  status: Schema.Int,
  instance: Schema.String,
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
});

const ValueIdSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const VariablesSchema = Schema.Record(Schema.String, ValueIdSchema);

const TaskFrameReference = Schema.suspend((): Schema.Codec<unknown, unknown> => TaskFrameSchema);

const ListCursorSchema = Schema.Struct({
  pointer: Schema.String,
  position: Schema.Int,
  data: ValueIdSchema,
  variables: VariablesSchema,
  current: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('running'), task: TaskFrameReference }),
    Schema.Struct({ kind: Schema.Literal('yielding'), timer: Schema.String }),
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
  Schema.Struct({ kind: Schema.Literal('backing_off'), timer: Schema.String, error: DslErrorSchema }),
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
  }),
  Schema.Struct({ kind: Schema.Literal('listen'), consumed: Schema.Array(ValueIdSchema) }),
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

export const RunOutcomeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('completed'), output: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal('raised'), error: DslErrorSchema }),
  Schema.Struct({ kind: Schema.Literal('cancelled') }),
  Schema.Struct({ kind: Schema.Literal('broken'), reason: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('oversized'), bytes: Schema.Int, most: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal('overran'), milliseconds: Schema.Int }),
]);

const FormatTwoSchema = Schema.Struct({
  executionId: Schema.String,
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
  inbox: Schema.Struct({
    waiting: Schema.Array(Schema.Struct({ event: ReceivedEventSchema, bytes: Schema.Int })),
    waitingBytes: Schema.Int,
    receivedIds: Schema.Array(Schema.String),
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

const readFormatTwo = Schema.decodeUnknownSync(FormatTwoSchema, { onExcessProperty: 'error' });

const initialOfFormatTwo = {
  executionId: '',
  status: 'new',
  workflow: null,
  attributes: {},
  limits: { mostDurationMs: 1, longestCallMs: 1 },
  startedAt: 0,
  lastInputAt: 0,
  inputs: 0,
  random: { seed: 0, draws: 0 },
  runs: {},
  timers: { next: 1, armed: {} },
  calls: {},
  inbox: { waiting: [], waitingBytes: 0, receivedIds: [], received: 0, receivedBytes: 0 },
  heldBytes: 0,
  historyBytes: 0,
  stepsWithoutWaiting: 0,
  cancelRequested: false,
  machine: { values: { 0: { value: {}, bytes: 2 } }, nextValue: 1, context: 0, root: null },
  outcome: null,
};

export const formatTwo: OlderFormat = {
  format: 2,
  initial: initialOfFormatTwo,
  read: (state) => readFormatTwo(state),
  upcast: (state) => state,
};
