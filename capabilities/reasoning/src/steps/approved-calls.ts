import { Effect } from 'effect';

import { noLongerOfferedWords, notPassedOn } from '../approvals/approval-words.ts';
import type { PendingApproval } from '../approvals/pending-approvals.ts';
import { roomOfEachAnswer } from '../tools/turn-meter.ts';
import { resolvedIn } from './asked-calls.ts';
import type { ApprovedCallNext, ToolCallsNext } from './step-decision.ts';
import type { StepRecording, StepRefusal, StepRun } from './step-run.ts';
import type { StepState } from './step-state.ts';
import { toolCallsMade } from './tool-steps.ts';

export type ApprovedSending =
  | { readonly type: 'send'; readonly next: ToolCallsNext }
  | { readonly type: 'answered'; readonly state: StepState };

function answeredInstead(state: StepState, approval: PendingApproval, text: string): ApprovedSending {
  const asking = resolvedIn(state.asking, approval.callId, { text, isError: true });
  return { type: 'answered', state: { ...state, approval: null, asking } };
}

export function approvedSendingOf(
  run: StepRecording,
  state: StepState,
  { approval }: ApprovedCallNext,
): Effect.Effect<ApprovedSending> {
  const call = state.asking.admitted.find(({ callId }) => callId === approval.callId);
  if (call === undefined) {
    return Effect.succeed(answeredInstead(state, approval, noLongerOfferedWords(approval.asked.tool)));
  }
  const room = roomOfEachAnswer(state.meter, run.bounds.limits);
  return Effect.map(run.approvals.signed(approval, call), (signed): ApprovedSending =>
    signed === undefined
      ? answeredInstead(state, approval, notPassedOn)
      : { type: 'send', next: { type: 'tool_calls', calls: [call], room, approval: signed } },
  );
}

export function approvedCallMade(
  run: StepRun,
  state: StepState,
  next: ApprovedCallNext,
): Effect.Effect<StepState, StepRefusal> {
  return Effect.flatMap(approvedSendingOf(run, state, next), (sending) =>
    sending.type === 'answered' ? Effect.succeed(sending.state) : toolCallsMade(run, state, sending.next),
  );
}
