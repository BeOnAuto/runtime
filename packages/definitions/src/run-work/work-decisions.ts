import { Conflict, RunCancelled, type Rejection } from '@on.auto/operations';
import { answerPayloadOf } from '@on.auto/operations/payloads';
import { Result } from 'effect';

import { isCallStart, numberedCall } from '../journal/call-numbering.ts';
import { comparedPayloads, comparedWithoutItsValue } from '../payloads/payload-comparisons.ts';
import { takesAnAnswer } from '../requests/request-record.ts';
import type { CapabilityFact, RunAnswer, RunCall, RunWork } from '../runs/run-commands.ts';
import type { RunEvent } from '../runs/run-events.ts';
import {
  awaitsSettlement,
  isRunning,
  takesSettlement,
  type AskedCancel,
  type RecordedAnswer,
  type RunState,
} from '../runs/run-state.ts';
import { canonicallyEqual } from '../runs/settlement-keys.ts';

type Decision = Result.Result<readonly RunEvent[], Rejection<'conflict' | 'cancelled' | 'unavailable'>>;

export type AdmitsFact = (fact: CapabilityFact) => boolean;

export const runEnded = new Conflict({ detail: 'The run has ended, so it records no more of its work', kind: 'taken' });

export function cancelledAsAsked({ reason, kind }: AskedCancel): RunCancelled {
  return new RunCancelled({ detail: reason, kind });
}

export function decideCall({ fact }: RunCall, state: RunState): Decision {
  if (state === undefined || !isRunning(state)) {
    return Result.fail(runEnded);
  }
  if (state.resumes && state.cancel !== undefined && isCallStart(fact)) {
    return Result.fail(cancelledAsAsked(state.cancel));
  }
  return Result.map(numberedCall(state, fact), (numbered) => [numbered]);
}

function undeclared({ type }: CapabilityFact): Conflict {
  return new Conflict({
    detail: `No capability of this playbook declares the fact ${type}, so the run does not record it`,
  });
}

export function decideWork({ fact }: RunWork, state: RunState, admits: AdmitsFact): Decision {
  if (state === undefined || !takesSettlement(state)) {
    return Result.fail(runEnded);
  }
  return admits(fact) ? Result.succeed([{ type: 'work', data: { fact } }]) : Result.fail(undeclared(fact));
}

export const answeredAlready = new Conflict({
  detail: 'The run already took another answer, and a run takes one answer, so it takes no other',
});

const takesNoAnswer = new Conflict({ detail: 'The run waits on no request that takes an answer' });

export const endedUnanswered = new Conflict({
  detail: 'The run is not waiting for an answer: it has ended, or has not asked yet, so it takes none',
});

export const cancelledUnanswered = new Conflict({
  detail: 'A cancel of the run was asked before it took an answer, so it takes none',
});

function answeredAgain(taken: RecordedAnswer, { answer, valuesRead }: RunAnswer): Decision {
  const compared = comparedPayloads(taken.answer, answerPayloadOf({ data: answer }), canonicallyEqual, valuesRead);
  if (compared === 'unknown') {
    return Result.fail(comparedWithoutItsValue);
  }
  return compared === 'same' ? Result.succeed([]) : Result.fail(answeredAlready);
}

export function decideAnswer(command: RunAnswer, state: RunState): Decision {
  const taken = state?.answer ?? null;
  if (taken !== null) {
    return answeredAgain(taken, command);
  }
  if (state === undefined || !awaitsSettlement(state)) {
    return Result.fail(endedUnanswered);
  }
  if (state.cancel !== undefined) {
    return Result.fail(cancelledUnanswered);
  }
  return takesAnAnswer(state.record)
    ? Result.succeed([{ type: 'request_answered', data: command.answer }])
    : Result.fail(takesNoAnswer);
}
