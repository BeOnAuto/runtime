import { Schema } from 'effect';

import type { CallKey } from '../../executor/call-key.ts';
import type { OlderFormat } from '../state-format.ts';
import { CallKeySchema, InstantSchema, ReceivedEventSchema, TimerPurposeSchema } from './format-two.ts';

const DslErrorSchema = Schema.Struct({
  type: Schema.String,
  status: Schema.Int,
  instance: Schema.String,
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
});

export const RunCountSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const StepOutcomeSchema = Schema.Literals([
  'started',
  'skipped',
  'waiting',
  'completed',
  'raised',
  'timed_out',
  'cancelled',
]);

export const StepCauseSchema = Schema.Union([
  Schema.Literal('input'),
  Schema.Struct({ reference: Schema.String, run: RunCountSchema, outcome: StepOutcomeSchema, times: RunCountSchema }),
]);

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

const FormatSixSchema = Schema.Struct({
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

type FormatSix = typeof FormatSixSchema.Type;

const readFormatSix = Schema.decodeUnknownSync(FormatSixSchema, { onExcessProperty: 'error' });

type Fields = Readonly<Record<string, unknown>>;

function isRecord(node: unknown): node is Fields {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

export function withRunId<Named extends { readonly executionId: string }>({ executionId, ...named }: Named) {
  return { ...named, runId: executionId };
}

export function withExecutionId<Named extends { readonly runId: string }>({ runId, ...named }: Named) {
  return { ...named, executionId: runId };
}

const isKeyOfFormatSix = Schema.is(CallKeySchema);

function keysWithRunId(keys: Readonly<Record<string, typeof CallKeySchema.Type>>): Readonly<Record<string, CallKey>> {
  return Object.fromEntries(
    Object.entries(keys).map(([text, key]: readonly [string, typeof CallKeySchema.Type]) => [text, withRunId(key)]),
  );
}

function callsWithRunId(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item: unknown) => callsWithRunId(item));
  }
  if (!isRecord(node)) {
    return node;
  }
  const walked = Object.fromEntries(
    Object.entries(node).map(([name, item]: readonly [string, unknown]) => [name, callsWithRunId(item)]),
  );
  const { kind, key } = node;
  return kind === 'call' && isKeyOfFormatSix(key) ? { ...walked, key: withRunId(key) } : walked;
}

function upcastFormatSix({ calls, listeners, machine, ...state }: FormatSix): unknown {
  return withRunId({
    ...state,
    calls: keysWithRunId(calls),
    listeners: keysWithRunId(listeners),
    machine: { ...machine, root: callsWithRunId(machine.root) },
  });
}

const initialOfFormatSix = {
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
  listeners: {},
  emitted: { count: 0, bytes: 0 },
  inbox: { waiting: [], waitingBytes: 0, receivedIds: [], offeredIds: [], received: 0, receivedBytes: 0 },
  heldBytes: 0,
  historyBytes: 0,
  stepsWithoutWaiting: 0,
  cancelRequested: false,
  machine: { values: { 0: { value: {}, bytes: 2 } }, nextValue: 1, context: 0, root: null },
  outcome: null,
};

export const formatSix: OlderFormat = {
  format: 6,
  initial: initialOfFormatSix,
  read: (state) => readFormatSix(state),
  upcast: (state) => upcastFormatSix(readFormatSix(state)),
};
