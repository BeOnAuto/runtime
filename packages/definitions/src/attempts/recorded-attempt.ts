import type { Fold } from '@on.auto/operations';

import type { WaitedRequest } from '../capability/run-context.ts';
import {
  RunEventSchema,
  isCallFact,
  type RecordedCall,
  type RecordedRunEvent,
  type RecordedRunFact,
} from '../runs/run-events.ts';
import { recordedAnswerOf } from '../runs/run-state.ts';

export interface RecordedAttempt {
  readonly startedAt: string;
  readonly modelCallsBefore: number;
  readonly lastModelCall: number;
  readonly calls: readonly RecordedCall[];
  readonly waitedMs: number;
  readonly requests: number;
  readonly waiting: WaitedRequest | null;
  readonly request?: WaitedRequest;
}

const nothingRecorded: RecordedAttempt = {
  startedAt: '',
  modelCallsBefore: 0,
  lastModelCall: 0,
  calls: [],
  waitedMs: 0,
  requests: 0,
  waiting: null,
};

function lastModelCallAfter({ lastModelCall }: RecordedAttempt, call: RecordedCall): number {
  return call.type === 'model_call_started' ? call.data.number : lastModelCall;
}

function startedAgain({ lastModelCall }: RecordedAttempt, at: string): RecordedAttempt {
  return { ...nothingRecorded, startedAt: at, modelCallsBefore: lastModelCall, lastModelCall };
}

function wentOn(attempt: RecordedAttempt, at: string): RecordedAttempt {
  const { waiting } = attempt;
  if (waiting === null) {
    return attempt;
  }
  return {
    ...attempt,
    waitedMs: attempt.waitedMs + Math.max(0, Date.parse(at) - Date.parse(waiting.at)),
    waiting: null,
    request: waiting,
  };
}

function answeredWhileWaiting(attempt: RecordedAttempt, event: RecordedRunFact<'request_answered'>): RecordedAttempt {
  const { waiting } = attempt;
  return waiting === null ? attempt : { ...attempt, waiting: { ...waiting, answer: recordedAnswerOf(event) } };
}

function evolveAttempt(attempt: RecordedAttempt, event: RecordedRunEvent): RecordedAttempt {
  if (event.type === 'run_started') {
    return startedAgain(attempt, event.context.at);
  }
  if (event.type === 'run_deferred') {
    const waiting = { record: event.data.record, at: event.context.at, answer: null };
    return { ...attempt, requests: attempt.requests + 1, waiting };
  }
  if (event.type === 'request_answered') {
    return answeredWhileWaiting(attempt, event);
  }
  if (event.type === 'attempt_resumed') {
    return wentOn(attempt, event.context.at);
  }
  return isCallFact(event)
    ? { ...attempt, lastModelCall: lastModelCallAfter(attempt, event), calls: [...attempt.calls, event] }
    : attempt;
}

export const recordedAttempt: Fold<RecordedAttempt, RecordedRunEvent> = {
  initialState: nothingRecorded,
  evolve: evolveAttempt,
  eventSchema: RunEventSchema,
};
