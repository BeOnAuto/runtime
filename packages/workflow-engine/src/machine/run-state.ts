import { Schema } from 'effect';

import { CallKeySchema, type CallKey } from '../executor/call-key.ts';
import { RefusedCallsSchema, type RefusedCalls } from '../executor/refused-calls.ts';
import { InboxStateSchema, type InboxState } from '../inbox/inbox-state.ts';
import { StepCauseSchema, type StepCause } from '../steps/step-entry.ts';
import { TimerPurposeSchema, type TimerPurpose } from '../timers/timer-id.ts';
import { DslErrorSchema, type DslError } from './dsl-error.ts';
import { InstantSchema } from './instant.ts';
import { CancelOrderSchema, RunLimitsSchema, type CancelOrder, type RunLimits } from './run-input.ts';

export type ValueId = number;

export interface HeldValue {
  readonly value: Schema.Json;
  readonly bytes: number;
}

export type Variables = Readonly<Record<string, ValueId>>;

export type CursorCurrent =
  | { readonly kind: 'running'; readonly task: TaskFrame }
  | { readonly kind: 'yielding'; readonly timer: string; readonly after: StepCause };

export interface ListCursor {
  readonly pointer: string;
  readonly position: number;
  readonly data: ValueId;
  readonly variables: Variables;
  readonly current: CursorCurrent;
}

export type Branch =
  | { readonly state: 'yielding'; readonly timer: string }
  | { readonly state: 'running'; readonly task: TaskFrame }
  | { readonly state: 'finished'; readonly output: ValueId; readonly flow: string }
  | { readonly state: 'failed'; readonly error: DslError; readonly order: number };

export type TryPhase =
  | { readonly kind: 'trying'; readonly list: ListCursor; readonly attemptLimit: string | null }
  | { readonly kind: 'backing_off'; readonly timer: string; readonly error: DslError; readonly failed: StepCause }
  | { readonly kind: 'recovering'; readonly list: ListCursor };

export type FrameBody =
  | { readonly kind: 'list'; readonly list: ListCursor }
  | {
      readonly kind: 'for';
      readonly items: ValueId;
      readonly index: number;
      readonly data: ValueId;
      readonly list: ListCursor;
    }
  | { readonly kind: 'fork'; readonly compete: boolean; readonly branches: readonly Branch[] }
  | { readonly kind: 'try'; readonly attempt: number; readonly startedAt: number; readonly phase: TryPhase }
  | { readonly kind: 'wait'; readonly timer: string }
  | {
      readonly kind: 'call';
      readonly key: CallKey;
      readonly function: string;
      readonly arguments: ValueId;
      readonly label: string;
      readonly deadline: string;
      readonly refused?: RefusedCalls;
    }
  | {
      readonly kind: 'admission';
      readonly function: string;
      readonly arguments: ValueId;
      readonly label: string;
      readonly timer: string;
      readonly refused: RefusedCalls;
    }
  | { readonly kind: 'listen'; readonly consumed: readonly (ValueId | null)[]; readonly waited: number };

export interface TaskFrame {
  readonly reference: string;
  readonly run: number;
  readonly startedAt: number;
  readonly context: ValueId;
  readonly rawInput: ValueId;
  readonly input: ValueId;
  readonly variables: Variables;
  readonly timeout: string | null;
  readonly body: FrameBody;
}

export interface MachineState {
  readonly values: Readonly<Record<string, HeldValue>>;
  readonly nextValue: ValueId;
  readonly context: ValueId;
  readonly root: TaskFrame | null;
}

export type RunOutcome =
  | { readonly kind: 'completed'; readonly output: Schema.Json }
  | { readonly kind: 'raised'; readonly error: DslError }
  | { readonly kind: 'cancelled'; readonly cancel: CancelOrder }
  | { readonly kind: 'broken'; readonly reason: string }
  | { readonly kind: 'oversized'; readonly bytes: number; readonly most: number }
  | { readonly kind: 'overran'; readonly milliseconds: number };

export interface ArmedTimer {
  readonly purpose: TimerPurpose;
  readonly reference: string;
  readonly armedAt: number;
  readonly dueAt: number;
}

export interface EmittedEvents {
  readonly count: number;
  readonly bytes: number;
}

export interface RunState {
  readonly runId: string;
  readonly status: 'new' | 'running' | 'ended';
  readonly workflow: { readonly document: Schema.JsonObject; readonly input: ValueId } | null;
  readonly attributes: Schema.JsonObject;
  readonly limits: RunLimits;
  readonly startedAt: number;
  readonly lastInputAt: number;
  readonly inputs: number;
  readonly random: { readonly seed: number; readonly draws: number };
  readonly runs: Readonly<Record<string, number>>;
  readonly timers: { readonly next: number; readonly armed: Readonly<Record<string, ArmedTimer>> };
  readonly calls: Readonly<Record<string, CallKey>>;
  readonly listeners: Readonly<Record<string, CallKey>>;
  readonly emitted: EmittedEvents;
  readonly inbox: InboxState;
  readonly heldBytes: number;
  readonly historyBytes: number;
  readonly stepsWithoutWaiting: number;
  readonly cancelRequested: boolean;
  readonly machine: MachineState;
  readonly outcome: RunOutcome | null;
}

const IntSchema = Schema.Int;

const ValueIdSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const VariablesSchema = Schema.Record(Schema.String, ValueIdSchema);

const TaskFrameReference = Schema.suspend((): Schema.Codec<TaskFrame> => TaskFrameSchema);

const CursorCurrentSchema: Schema.Codec<CursorCurrent> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('running'), task: TaskFrameReference }),
  Schema.Struct({ kind: Schema.Literal('yielding'), timer: Schema.String, after: StepCauseSchema }),
]);

const ListCursorSchema: Schema.Codec<ListCursor> = Schema.Struct({
  pointer: Schema.String,
  position: IntSchema,
  data: ValueIdSchema,
  variables: VariablesSchema,
  current: CursorCurrentSchema,
});

const BranchSchema: Schema.Codec<Branch> = Schema.Union([
  Schema.Struct({ state: Schema.Literal('yielding'), timer: Schema.String }),
  Schema.Struct({ state: Schema.Literal('running'), task: TaskFrameReference }),
  Schema.Struct({ state: Schema.Literal('finished'), output: ValueIdSchema, flow: Schema.String }),
  Schema.Struct({ state: Schema.Literal('failed'), error: DslErrorSchema, order: IntSchema }),
]);

const TryPhaseSchema: Schema.Codec<TryPhase> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('trying'), list: ListCursorSchema, attemptLimit: Schema.NullOr(Schema.String) }),
  Schema.Struct({
    kind: Schema.Literal('backing_off'),
    timer: Schema.String,
    error: DslErrorSchema,
    failed: StepCauseSchema,
  }),
  Schema.Struct({ kind: Schema.Literal('recovering'), list: ListCursorSchema }),
]);

const FrameBodySchema: Schema.Codec<FrameBody> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('list'), list: ListCursorSchema }),
  Schema.Struct({
    kind: Schema.Literal('for'),
    items: ValueIdSchema,
    index: IntSchema,
    data: ValueIdSchema,
    list: ListCursorSchema,
  }),
  Schema.Struct({ kind: Schema.Literal('fork'), compete: Schema.Boolean, branches: Schema.Array(BranchSchema) }),
  Schema.Struct({ kind: Schema.Literal('try'), attempt: IntSchema, startedAt: InstantSchema, phase: TryPhaseSchema }),
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
    waited: IntSchema,
  }),
]);

const TaskFrameSchema: Schema.Codec<TaskFrame> = Schema.Struct({
  reference: Schema.String,
  run: IntSchema,
  startedAt: InstantSchema,
  context: ValueIdSchema,
  rawInput: ValueIdSchema,
  input: ValueIdSchema,
  variables: VariablesSchema,
  timeout: Schema.NullOr(Schema.String),
  body: FrameBodySchema,
});

const RunOutcomeSchema: Schema.Codec<RunOutcome> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('completed'), output: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal('raised'), error: DslErrorSchema }),
  Schema.Struct({ kind: Schema.Literal('cancelled'), cancel: CancelOrderSchema }),
  Schema.Struct({ kind: Schema.Literal('broken'), reason: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('oversized'), bytes: IntSchema, most: IntSchema }),
  Schema.Struct({ kind: Schema.Literal('overran'), milliseconds: IntSchema }),
]);

export const RunStateSchema: Schema.Codec<RunState> = Schema.Struct({
  runId: Schema.String,
  status: Schema.Literals(['new', 'running', 'ended']),
  workflow: Schema.NullOr(Schema.Struct({ document: Schema.JsonObject, input: ValueIdSchema })),
  attributes: Schema.JsonObject,
  limits: RunLimitsSchema,
  startedAt: InstantSchema,
  lastInputAt: InstantSchema,
  inputs: IntSchema,
  random: Schema.Struct({ seed: IntSchema, draws: IntSchema }),
  runs: Schema.Record(Schema.String, IntSchema),
  timers: Schema.Struct({
    next: IntSchema,
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
  emitted: Schema.Struct({ count: IntSchema, bytes: IntSchema }),
  inbox: InboxStateSchema,
  heldBytes: IntSchema,
  historyBytes: IntSchema,
  stepsWithoutWaiting: IntSchema,
  cancelRequested: Schema.Boolean,
  machine: Schema.Struct({
    values: Schema.Record(Schema.String, Schema.Struct({ value: Schema.Json, bytes: IntSchema })),
    nextValue: ValueIdSchema,
    context: ValueIdSchema,
    root: Schema.NullOr(TaskFrameSchema),
  }),
  outcome: Schema.NullOr(RunOutcomeSchema),
});

export const newRun: RunState = {
  runId: '',
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
