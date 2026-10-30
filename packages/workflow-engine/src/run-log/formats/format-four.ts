import { Schema } from 'effect';

import type { OlderFormat } from '../state-format.ts';
import {
  CallKeySchema,
  InstantSchema,
  ReceivedEventSchema,
  RunLimitsSchema,
  TimerPurposeSchema,
} from './format-two.ts';

const DslErrorSchema = Schema.Struct({
  type: Schema.String,
  status: Schema.Int,
  instance: Schema.String,
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
});

const RunCountSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const StepCauseSchema = Schema.Union([
  Schema.Literal('input'),
  Schema.Struct({
    reference: Schema.String,
    run: RunCountSchema,
    outcome: Schema.Literals(['started', 'skipped', 'waiting', 'completed', 'raised', 'timed_out', 'cancelled']),
    times: RunCountSchema,
  }),
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
  Schema.Struct({ kind: Schema.Literal('listen'), consumed: Schema.Array(ValueIdSchema), waited: Schema.Int }),
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

const RunOutcomeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('completed'), output: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal('raised'), error: DslErrorSchema }),
  Schema.Struct({ kind: Schema.Literal('cancelled') }),
  Schema.Struct({ kind: Schema.Literal('broken'), reason: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('oversized'), bytes: Schema.Int, most: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal('overran'), milliseconds: Schema.Int }),
]);

const FormatFourSchema = Schema.Struct({
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

type FormatFour = typeof FormatFourSchema.Type;

const readFormatFour = Schema.decodeUnknownSync(FormatFourSchema, { onExcessProperty: 'error' });

type Fields = Readonly<Record<string, unknown>>;

interface ListenFrame {
  readonly reference: string;
  readonly run: number;
}

function isRecord(node: unknown): node is Fields {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

function fieldOf(node: unknown, key: string): unknown {
  return isRecord(node) && Object.hasOwn(node, key) ? node[key] : undefined;
}

function listenFramesIn(node: unknown): readonly ListenFrame[] {
  if (Array.isArray(node)) {
    return node.flatMap((item: unknown) => listenFramesIn(item));
  }
  if (!isRecord(node)) {
    return [];
  }
  const nested = Object.values(node).flatMap((item: unknown) => listenFramesIn(item));
  const { reference, run } = node;
  const isListen = fieldOf(node['body'], 'kind') === 'listen';
  return isListen && typeof reference === 'string' && typeof run === 'number'
    ? [{ reference, run }, ...nested]
    : nested;
}

function taskAt(document: unknown, reference: string): unknown {
  return reference
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce(
      (node: unknown, segment) => (Array.isArray(node) ? node[Number(segment)] : fieldOf(node, segment)),
      document,
    );
}

function filtersOf(task: unknown): readonly unknown[] {
  const to = fieldOf(fieldOf(task, 'listen'), 'to');
  const one = fieldOf(to, 'one');
  if (one !== undefined) {
    return [one];
  }
  const listed = fieldOf(to, 'all') ?? fieldOf(to, 'any');
  return Array.isArray(listed) ? listed : [];
}

function isPlaybookWide(filter: unknown): boolean {
  const type = fieldOf(fieldOf(filter, 'with'), 'type');
  return typeof type === 'string' && type !== '' && !type.trimStart().startsWith('${');
}

function listenersOf({ executionId, workflow, machine }: FormatFour): Fields {
  const listening = listenFramesIn(machine.root).filter(({ reference }) =>
    filtersOf(taskAt(workflow?.document, reference)).some((filter) => isPlaybookWide(filter)),
  );
  return Object.fromEntries(
    listening.map(({ reference, run }) => {
      const key = { executionId, reference, run };
      return [JSON.stringify([executionId, reference, run]), key];
    }),
  );
}

function upcastFormatFour(state: FormatFour): unknown {
  return {
    ...state,
    listeners: listenersOf(state),
    emitted: { count: 0, bytes: 0 },
    inbox: { ...state.inbox, offeredIds: [] },
  };
}

const initialOfFormatFour = {
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

export const formatFour: OlderFormat = {
  format: 4,
  initial: initialOfFormatFour,
  read: (state) => readFormatFour(state),
  upcast: (state) => upcastFormatFour(readFormatFour(state)),
};
