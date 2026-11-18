import type { CalledBy, RecordedCaller, RunContext, StartingTrigger } from '@on.auto/operations';
import { answerPayloadOf, inputPayloadOf, type Payload } from '@on.auto/operations/payloads';
import type { Schema } from 'effect';

import { isCallStart, numberingAfter, numberingFrom, type CallNumbering } from '../journal/call-numbering.ts';
import { finishedRecord, recordOf, resultOf, type RecordedFinish } from './finished-runs.ts';
import { firstAttempt, type RunCall, type RunOutcome, type RunResult } from './run-commands.ts';
import type {
  CancelRequestKind,
  RecordedCallFact,
  RecordedRunEvent,
  RecordedRunFact,
  ReplyIdentity,
} from './run-events.ts';
import type { RunRecord, RunRejection } from './run.ts';

export interface AskedCancel {
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly by: string;
}

export interface RecordedAnswer {
  readonly answer: Payload<Schema.Json>;
  readonly claimedFor?: string;
  readonly reply?: ReplyIdentity;
  readonly by: RecordedCaller;
  readonly at: string;
}

export interface RecordedWork {
  readonly type: string;
  readonly data: Schema.JsonObject;
  readonly context: RunContext;
}

export interface RecordedRunState extends CallNumbering {
  readonly attempt: number;
  readonly fencingToken: number;
  readonly holderStartedACall: boolean;
  readonly input: Payload<Schema.Json>;
  readonly run: RunRecord;
  readonly finishesLater: boolean;
  readonly deferred: boolean;
  readonly callsTools: boolean;
  readonly resumes: boolean;
  readonly mayHaveChanged: boolean;
  readonly calledOnlyReadOnly: boolean;
  readonly openActingCalls: ReadonlySet<number>;
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

type CallsBefore = CallNumbering & Pick<RecordedRunState, 'mayHaveChanged' | 'calledOnlyReadOnly' | 'openActingCalls'>;

function callsBefore(earlier: RunState): CallsBefore {
  const openActingCalls = new Set<number>();
  return earlier === undefined
    ? { ...numberingFrom(0, 0), mayHaveChanged: false, calledOnlyReadOnly: true, openActingCalls }
    : {
        ...numberingFrom(earlier.lastCall, earlier.lastModelCall),
        mayHaveChanged: earlier.mayHaveChanged,
        calledOnlyReadOnly: earlier.calledOnlyReadOnly,
        openActingCalls,
      };
}

function definitionOf({ definitionType, definitionName, definitionVersion }: RunContext) {
  return { type: definitionType, name: definitionName, definition_version: definitionVersion };
}

function startedRun(started: RecordedRunFact<'run_started'>, earlier: RunState): RecordedRunState {
  const { data, context } = started;
  const { started_by, calls_tools, finishes_later, resumes, output_shape } = data;
  const { at, depth = 0, callDepth = 0, calledBy, trigger, actsFor } = context;
  return {
    attempt: firstAttempt,
    fencingToken: (earlier?.fencingToken ?? 0) + 1,
    holderStartedACall: false,
    input: inputPayloadOf(started),
    run: {
      ...definitionOf(context),
      ...(output_shape === undefined ? {} : { output_shape }),
      status: 'started',
      started_at: at,
      started_by,
      ...(actsFor === undefined ? {} : { acts_for: actsFor }),
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

export function recordedAnswerOf(fact: RecordedAnswerFact): RecordedAnswer {
  const { data, context } = fact;
  const { claimed_for: claimedFor, reply, answered_by: by } = data;
  return {
    answer: answerPayloadOf(fact),
    ...(claimedFor === undefined ? {} : { claimedFor }),
    ...(reply === undefined ? {} : { reply }),
    by,
    at: context.at,
  };
}

function workOf({ data, context }: RecordedRunFact<'work'>): RecordedWork {
  return { type: data.fact.type, data: data.fact.data, context };
}

type RecordedAfterTheStart = Exclude<RecordedRunEvent, RecordedRunFact<'run_started'>>;

type RecordedWorkFact = Exclude<
  RecordedAfterTheStart,
  RecordedRunFact<
    'run_cancel_requested' | 'run_deferred' | 'attempt_resumed' | 'run_succeeded' | 'run_rejected' | 'run_failed'
  >
>;

function actingCallsAfter(open: ReadonlySet<number>, { type, data }: RecordedCallFact): ReadonlySet<number> {
  if (type === 'tool_call_started') {
    return data.read_only === true ? open : new Set([...open, data.number]);
  }
  return type === 'tool_call_answered' || type === 'tool_call_failed'
    ? new Set([...open].filter((number) => number !== data.number))
    : open;
}

function evolveWork(state: RecordedRunState, event: RecordedWorkFact): RecordedRunState {
  if (event.type === 'request_answered') {
    return { ...state, answer: recordedAnswerOf(event) };
  }
  if (event.type === 'work') {
    return { ...state, work: [...state.work, workOf(event)] };
  }
  const numbered = {
    ...state,
    ...numberingAfter(state, event),
    openActingCalls: actingCallsAfter(state.openActingCalls, event),
    holderStartedACall: state.holderStartedACall || isCallStart(event),
  };
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
    return { ...state, attempt: event.data.attempt, fencingToken: state.fencingToken + 1, holderStartedACall: false };
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

const finalReasons: ReadonlySet<RunRejection['reason']> = new Set(['invalid_input', 'cancelled', 'unanswered']);

function isFinalRejection(rejection: RunRejection | undefined): boolean {
  return rejection !== undefined && finalReasons.has(rejection.reason);
}

export function hasFinalResult({ run }: RecordedRunState): boolean {
  return run.status === 'succeeded' || isFinalRejection(run.rejection);
}

export function isFinalResult(outcome: RunOutcome): boolean {
  return (
    outcome.type === 'run_succeeded' || (outcome.type === 'run_rejected' && isFinalRejection(outcome.data.rejection))
  );
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

export function endsWithinItsCall(state: RecordedRunState): boolean {
  return isRunning(state) && !takesSettlement(state) && !state.resumes;
}

export function lastCallOf(state: RunState): number {
  return state?.lastCall ?? 0;
}

export function lastModelCallOf(state: RunState): number {
  return state?.lastModelCall ?? 0;
}

export function fencingTokenOf(state: RunState): number {
  return state?.fencingToken ?? 0;
}

export function holdsTheRun(fencingToken: number, state: RecordedRunState): boolean {
  return fencingToken === state.fencingToken;
}

export function startedByAnotherAttempt({ fact, fencingToken }: RunCall, state: RunState): boolean {
  return state !== undefined && isRunning(state) && isCallStart(fact) && !holdsTheRun(fencingToken, state);
}

export function mayHaveChangedSomething({ mayHaveChanged }: RecordedRunState): boolean {
  return mayHaveChanged;
}

export function calledAToolThatMayChangeSomething({ mayHaveChanged, calledOnlyReadOnly }: RecordedRunState): boolean {
  return mayHaveChanged && !calledOnlyReadOnly;
}

export function changedNothing(state: RecordedRunState): boolean {
  return state.mayHaveChanged && state.calledOnlyReadOnly && !isRunning(state);
}
