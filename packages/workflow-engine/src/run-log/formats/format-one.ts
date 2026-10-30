import { Schema } from 'effect';

import type { OlderFormat } from '../state-format.ts';
import { isRecord } from '../state-patch.ts';
import {
  CallKeySchema,
  DslErrorSchema,
  InstantSchema,
  ReceivedEventSchema,
  RunLimitsSchema,
  RunOutcomeSchema,
  TimerPurposeSchema,
} from './format-two.ts';

type Fields = Readonly<Record<string, unknown>>;

const ValueIdSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const VariablesSchema = Schema.Record(Schema.String, ValueIdSchema);

const FrameReference = Schema.suspend((): Schema.Codec<unknown, unknown> => FrameSchema);

const ListCursorSchema = Schema.Struct({
  pointer: Schema.String,
  position: Schema.Int,
  data: ValueIdSchema,
  variables: VariablesSchema,
  current: Schema.NullOr(
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal('running'), task: FrameReference }),
      Schema.Struct({ kind: Schema.Literal('yielding'), timer: Schema.String }),
    ]),
  ),
});

const BranchSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal('running'), task: FrameReference }),
  Schema.Struct({ state: Schema.Literal('finished'), output: ValueIdSchema, flow: Schema.String }),
  Schema.Struct({ state: Schema.Literal('failed'), error: DslErrorSchema }),
]);

const FrameBodySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('list'), list: ListCursorSchema }),
  Schema.Struct({
    kind: Schema.Literal('for'),
    items: ValueIdSchema,
    index: Schema.Int,
    data: ValueIdSchema,
    list: Schema.NullOr(ListCursorSchema),
  }),
  Schema.Struct({ kind: Schema.Literal('fork'), compete: Schema.Boolean, branches: Schema.Array(BranchSchema) }),
  Schema.Struct({
    kind: Schema.Literal('try'),
    attempt: Schema.Int,
    startedAt: InstantSchema,
    phase: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal('trying'),
        list: ListCursorSchema,
        attemptLimit: Schema.NullOr(Schema.String),
      }),
      Schema.Struct({ kind: Schema.Literal('backing_off'), timer: Schema.String, error: DslErrorSchema }),
      Schema.Struct({ kind: Schema.Literal('recovering'), list: ListCursorSchema }),
    ]),
  }),
  Schema.Struct({ kind: Schema.Literal('wait'), timer: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('call'),
    key: CallKeySchema,
    function: Schema.NonEmptyString,
    arguments: ValueIdSchema,
    label: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal('listen'), consumed: Schema.Array(ValueIdSchema) }),
]);

const FrameSchema = Schema.Struct({
  reference: Schema.String,
  run: Schema.Int,
  rawInput: ValueIdSchema,
  input: ValueIdSchema,
  variables: VariablesSchema,
  timeout: Schema.NullOr(Schema.String),
  body: FrameBodySchema,
});

const FormatOneSchema = Schema.Struct({
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
      Schema.Struct({ purpose: TimerPurposeSchema, reference: Schema.String, dueAt: InstantSchema }),
    ),
  }),
  calls: Schema.Record(Schema.String, CallKeySchema),
  inbox: Schema.Struct({
    waiting: Schema.Array(Schema.Struct({ event: ReceivedEventSchema, bytes: Schema.Int })),
    waitingBytes: Schema.Int,
    receivedIds: Schema.Array(Schema.String),
    received: Schema.Int,
    receivedBytes: Schema.Int,
    overflow: Schema.NullOr(DslErrorSchema),
  }),
  heldBytes: Schema.Int,
  historyBytes: Schema.Int,
  stepsWithoutWaiting: Schema.Int,
  cancelRequested: Schema.Boolean,
  machine: Schema.Struct({
    values: Schema.Record(Schema.String, Schema.Struct({ value: Schema.Json, bytes: Schema.Int })),
    nextValue: ValueIdSchema,
    context: ValueIdSchema,
    root: Schema.NullOr(FrameReference),
  }),
  outcome: Schema.NullOr(RunOutcomeSchema),
});

type FormatOne = typeof FormatOneSchema.Type;

type ArmedTimerOfFormatOne = FormatOne['timers']['armed'][string];

const readFormatOne = Schema.decodeUnknownSync(FormatOneSchema, { onExcessProperty: 'error' });

function withFailuresOrdered(branches: readonly unknown[]): readonly unknown[] {
  return branches.map((branch, order) =>
    isRecord(branch) && branch['state'] === 'failed' ? { ...branch, order } : branch,
  );
}

interface FrameFields {
  readonly startedAt: number;
  readonly context: number;
  readonly deadlines: Readonly<Record<string, string>>;
}

function deadlinesOf(armed: FormatOne['timers']['armed']): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(armed)
      .filter(([, { purpose }]: readonly [string, ArmedTimerOfFormatOne]) => purpose === 'call_deadline')
      .map(([id, { reference }]: readonly [string, ArmedTimerOfFormatOne]) => [reference, id]),
  );
}

function deadlineOf(node: Fields, deadlines: FrameFields['deadlines']): Fields {
  const key = node['kind'] === 'call' && isRecord(node['key']) ? node['key'] : {};
  const reference = key['reference'];
  return typeof reference === 'string' && Object.hasOwn(deadlines, reference) ? { deadline: deadlines[reference] } : {};
}

function withFrameFields(node: unknown, fields: FrameFields): unknown {
  if (Array.isArray(node)) {
    return node.map((item: unknown) => withFrameFields(item, fields));
  }
  if (!isRecord(node)) {
    return node;
  }
  const walked = Object.fromEntries(
    Object.entries(node).map(([key, item]: readonly [string, unknown]) => [key, withFrameFields(item, fields)]),
  );
  const branches = walked['branches'];
  const ordered = node['kind'] === 'fork' && Array.isArray(branches) ? { branches: withFailuresOrdered(branches) } : {};
  const frame = Object.hasOwn(node, 'rawInput') ? { startedAt: fields.startedAt, context: fields.context } : {};
  return { ...walked, ...ordered, ...frame, ...deadlineOf(node, fields.deadlines) };
}

function upcastFormatOne(state: FormatOne): unknown {
  const { lastInputAt, machine, timers, inbox } = state;
  const armed = Object.fromEntries(
    Object.entries(timers.armed).map(([id, timer]: readonly [string, ArmedTimerOfFormatOne]) => [
      id,
      { ...timer, armedAt: Math.min(lastInputAt, timer.dueAt) },
    ]),
  );
  const { overflow: _overflow, ...kept } = inbox;
  const fields = { startedAt: lastInputAt, context: machine.context, deadlines: deadlinesOf(timers.armed) };
  return {
    ...state,
    timers: { ...timers, armed },
    inbox: kept,
    machine: { ...machine, root: withFrameFields(machine.root, fields) },
  };
}

const initialOfFormatOne = {
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
  inbox: { waiting: [], waitingBytes: 0, receivedIds: [], received: 0, receivedBytes: 0, overflow: null },
  heldBytes: 0,
  historyBytes: 0,
  stepsWithoutWaiting: 0,
  cancelRequested: false,
  machine: { values: { 0: { value: {}, bytes: 2 } }, nextValue: 1, context: 0, root: null },
  outcome: null,
};

export const formatOne: OlderFormat = {
  format: 1,
  initial: initialOfFormatOne,
  read: (state) => readFormatOne(state),
  upcast: (state) => upcastFormatOne(readFormatOne(state)),
};
