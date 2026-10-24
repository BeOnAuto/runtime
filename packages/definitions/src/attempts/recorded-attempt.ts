import type { Fold } from '@on.auto/operations';

import { RunEventSchema, isCallFact, type RecordedCall, type RecordedRunEvent } from '../runs/run-events.ts';

export interface RecordedAttempt {
  readonly startedAt: string;
  readonly modelCallsBefore: number;
  readonly lastModelCall: number;
  readonly calls: readonly RecordedCall[];
}

const nothingRecorded: RecordedAttempt = {
  startedAt: '',
  modelCallsBefore: 0,
  lastModelCall: 0,
  calls: [],
};

function lastModelCallAfter({ lastModelCall }: RecordedAttempt, call: RecordedCall): number {
  return call.type === 'model_call_started' ? call.data.number : lastModelCall;
}

function evolveAttempt(attempt: RecordedAttempt, event: RecordedRunEvent): RecordedAttempt {
  if (event.type === 'run_started') {
    return { ...attempt, startedAt: event.context.at, modelCallsBefore: attempt.lastModelCall, calls: [] };
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
