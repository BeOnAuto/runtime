import type { RecordedAnswer, RunAttempt } from '@on.auto/definitions';

import { resolvedIn } from '../steps/asked-calls.ts';
import type { StepState } from '../steps/step-state.ts';
import { approvalAnswerOf, waitedApprovalOf, type WaitedApproval } from './approval-requests.ts';
import { declinedWords, expiredWords } from './approval-words.ts';

function stillWaited({ facts: { numbering } }: StepState, { call }: WaitedApproval): boolean {
  return numbering.lastCall === call.last_call && numbering.lastModelCall === call.last_model_call;
}

function approvedBy(answer: RecordedAnswer | null): RecordedAnswer | undefined {
  return answer !== null && approvalAnswerOf(answer.answer)?.approved === true ? answer : undefined;
}

function refusedWords(waited: WaitedApproval, answer: RecordedAnswer | null): string {
  return answer === null ? expiredWords(waited.expires_at) : declinedWords(approvalAnswerOf(answer.answer)?.reason);
}

export function goneOnFrom(state: StepState, request: RunAttempt['request']): StepState {
  const waited = request === undefined ? undefined : waitedApprovalOf(request.record);
  if (request === undefined || waited === undefined || !stillWaited(state, waited)) {
    return state;
  }
  const { call } = waited;
  const approved = approvedBy(request.answer);
  if (approved !== undefined) {
    const approval = { callId: call.call_id, number: call.number, server: waited.approval.server, asked: call.asked };
    return { ...state, approval: { ...approval, person: approved.by.id, approvedAt: approved.at } };
  }
  const reply = { text: refusedWords(waited, request.answer), isError: true };
  return { ...state, approval: null, asking: resolvedIn(state.asking, call.call_id, reply) };
}
