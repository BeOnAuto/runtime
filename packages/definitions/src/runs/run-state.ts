import type { CalledBy, RecordedCaller, RunContext, StartingTrigger } from '@on.auto/operations';
import type { Schema } from 'effect';

import { numberingAfter, numberingFrom, type CallNumbering } from '../journal/call-numbering.ts';
import { firstAttempt, type RunResult } from './run-commands.ts';
import type { CancelRequestKind, RecordedRunEvent, RecordedRunFact, ReplyIdentity } from './run-events.ts';
import type { RunRecord } from './run.ts';

export interface AskedCancel {
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly by: string;
}

export interface RecordedAnswer {
  readonly answer: Schema.Json;
  readonly claimedFor?: string;
  readonly reply?: ReplyIdentity;
  readonly by: RecordedCaller;
  readonly at: string;
}

export interface RecordedWork {
  readonly type: string;
  readonly data: Schema.JsonObject;
  readonly at: string;
}

export interface ModelCallCost {
  readonly number: number;
  readonly cost_usd: number;
}

export interface RecordedRunState extends CallNumbering {
  readonly attempt: number;
  readonly input: Schema.Json;
  readonly run: RunRecord;
  readonly finishesLater: boolean;
  readonly deferred: boolean;
  readonly callsTools: boolean;
  readonly resumes: boolean;
  readonly mayHaveChanged: boolean;
  readonly calledOnlyReadOnly: boolean;
  readonly costs: readonly ModelCallCost[];
  readonly answer: RecordedAnswer | null;
  readonly work: readonly RecordedWork[];
  readonly cancel?: AskedCancel;
  readonly depth: number;
  readonly callDepth: number;
  readonly calledBy?: CalledBy;
  readonly trigger?: StartingTrigger;
  readonly record?: Schema.JsonObject;
  readonly result?: RunResult;
}

export type RunState = RecordedRunState | undefined;

interface CancelledBeforeStart {
  readonly cancelledBeforeStart: AskedCancel;
}

export type RunStreamState = RunState | CancelledBeforeStart;

export function startedRunOf(state: RunStreamState): RunState {
  return state === undefined || 'cancelledBeforeStart' in state ? undefined : state;
}

export function cancelBeforeStartOf(state: RunStreamState): AskedCancel | undefined {
  return state !== undefined && 'cancelledBeforeStart' in state ? state.cancelledBeforeStart : undefined;
}

type CallsBefore = CallNumbering & Pick<RecordedRunState, 'mayHaveChanged' | 'calledOnlyReadOnly' | 'costs'>;

function callsBefore(earlier: RunState): CallsBefore {
  return earlier === undefined
    ? { ...numberingFrom(0, 0), mayHaveChanged: false, calledOnlyReadOnly: true, costs: [] }
    : {
        ...numberingFrom(earlier.lastCall, earlier.lastModelCall),
        mayHaveChanged: earlier.mayHaveChanged,
        calledOnlyReadOnly: earlier.calledOnlyReadOnly,
        costs: earlier.costs,
      };
}

function definitionOf({ definitionType, definitionName, definitionVersion }: RunContext) {
  return { type: definitionType, name: definitionName, definition_version: definitionVersion };
}

type RecordedFinish = RecordedRunFact<'run_succeeded' | 'run_rejected' | 'run_failed'>;

function startedRun({ data, context }: RecordedRunFact<'run_started'>, earlier: RunState): RecordedRunState {
  const { input, started_by, calls_tools, finishes_later, resumes, output_shape } = data;
  const { at, depth = 0, callDepth = 0, calledBy, trigger } = context;
  return {
    attempt: firstAttempt,
    input,
    run: {
      ...definitionOf(context),
      ...(output_shape === undefined ? {} : { output_shape }),
      status: 'started',
      started_at: at,
      started_by,
    },
    finishesLater: finishes_later === true,
    deferred: false,
    callsTools: calls_tools === true,
    resumes: resumes === true,
    ...callsBefore(earlier),
    answer: null,
    work: [],
    depth,
    callDepth,
    ...(calledBy === undefined ? {} : { calledBy }),
    ...(trigger === undefined ? {} : { trigger }),
  };
}

function resultOf(event: RecordedFinish): RunResult {
  if (event.type === 'run_rejected') {
    return { type: event.type, data: { rejection: event.data.rejection } };
  }
  if (event.type === 'run_succeeded') {
    return { type: event.type, data: event.data };
  }
  return { type: event.type, data: event.data };
}

function finishedRecord(
  { type, name, definition_version, output_shape, started_at, started_by }: RunRecord,
  result: RunResult,
  at: string,
): RunRecord {
  const attempt = {
    type,
    name,
    definition_version,
    ...(output_shape === undefined ? {} : { output_shape }),
    started_at,
    started_by,
    finished_at: at,
  };
  if (result.type === 'run_succeeded') {
    return { ...attempt, status: 'succeeded', output: result.data.output };
  }
  if (result.type === 'run_rejected') {
    return { ...attempt, status: 'rejected', rejection: result.data.rejection };
  }
  return { ...attempt, status: 'failed' };
}

function recordOf(event: RecordedFinish): Schema.JsonObject | undefined {
  return event.type === 'run_failed' ? undefined : event.data.record;
}

function finishedRun(state: RecordedRunState, event: RecordedFinish): RecordedRunState {
  const result = resultOf(event);
  const finished = { ...state, run: finishedRecord(state.run, result, event.context.at), result };
  const record = recordOf(event);
  return record === undefined ? finished : { ...finished, record };
}

export interface RecordedAnswerFact {
  readonly data: RecordedRunFact<'request_answered'>['data'];
  readonly context: Pick<RunContext, 'at'>;
}

export function recordedAnswerOf({ data, context }: RecordedAnswerFact): RecordedAnswer {
  const { answer, claimed_for: claimedFor, reply, answered_by: by } = data;
  return {
    answer,
    ...(claimedFor === undefined ? {} : { claimedFor }),
    ...(reply === undefined ? {} : { reply }),
    by,
    at: context.at,
  };
}

function workOf({ data, context }: RecordedRunFact<'work'>): RecordedWork {
  return { type: data.fact.type, data: data.fact.data, at: context.at };
}

type RecordedAfterTheStart = Exclude<RecordedRunEvent, RecordedRunFact<'run_started'>>;

type RecordedWorkFact = Exclude<
  RecordedAfterTheStart,
  RecordedRunFact<
    'run_cancel_requested' | 'run_deferred' | 'attempt_resumed' | 'run_succeeded' | 'run_rejected' | 'run_failed'
  >
>;

function costsAfter(costs: readonly ModelCallCost[], event: RecordedWorkFact): readonly ModelCallCost[] {
  if (event.type !== 'model_call_answered' && event.type !== 'model_call_failed') {
    return costs;
  }
  const { number, cost_usd: cost } = event.data;
  return cost === undefined ? costs : [...costs, { number, cost_usd: cost }];
}

function evolveWork(state: RecordedRunState, event: RecordedWorkFact): RecordedRunState {
  if (event.type === 'request_answered') {
    return { ...state, answer: recordedAnswerOf(event) };
  }
  if (event.type === 'work') {
    return { ...state, work: [...state.work, workOf(event)] };
  }
  const numbered = { ...state, ...numberingAfter(state, event), costs: costsAfter(state.costs, event) };
  return event.type === 'tool_call_started'
    ? {
        ...numbered,
        mayHaveChanged: true,
        calledOnlyReadOnly: state.calledOnlyReadOnly && event.data.read_only === true,
      }
    : numbered;
}

function evolveStarted(state: RecordedRunState, event: RecordedAfterTheStart): RecordedRunState {
  if (event.type === 'run_cancel_requested') {
    const { kind, reason } = event.data;
    return { ...state, cancel: { kind, reason, by: event.context.by } };
  }
  if (event.type === 'run_deferred') {
    return { ...state, deferred: true, record: event.data.record };
  }
  if (event.type === 'attempt_resumed') {
    return { ...state, attempt: event.data.attempt };
  }
  return event.type === 'run_succeeded' || event.type === 'run_rejected' || event.type === 'run_failed'
    ? finishedRun(state, event)
    : evolveWork(state, event);
}

export function evolveRun(state: RunStreamState, event: RecordedRunEvent): RunStreamState {
  if (event.type === 'run_started') {
    return startedRun(event, startedRunOf(state));
  }
  const run = startedRunOf(state);
  if (run !== undefined) {
    return evolveStarted(run, event);
  }
  if (state === undefined && event.type === 'run_cancel_requested') {
    const { kind, reason } = event.data;
    return { cancelledBeforeStart: { kind, reason, by: event.context.by } };
  }
  return state;
}

export function hasFinalResult({ run }: RecordedRunState): boolean {
  const reason = run.rejection?.reason;
  return run.status === 'succeeded' || reason === 'invalid_input' || reason === 'cancelled' || reason === 'unanswered';
}

export function awaitsSettlement({ run, deferred }: RecordedRunState): boolean {
  return run.status === 'started' && deferred;
}

export function takesSettlement({ run, finishesLater, deferred }: RecordedRunState): boolean {
  return run.status === 'started' && (finishesLater || deferred);
}

export function isRunning({ run }: RecordedRunState): boolean {
  return run.status === 'started';
}

export function lastCallOf(state: RunState): number {
  return state?.lastCall ?? 0;
}

export function lastModelCallOf(state: RunState): number {
  return state?.lastModelCall ?? 0;
}

export function mayHaveChangedSomething({ mayHaveChanged }: RecordedRunState): boolean {
  return mayHaveChanged;
}

export function changedNothing(state: RecordedRunState): boolean {
  return state.mayHaveChanged && state.calledOnlyReadOnly && !isRunning(state);
}
