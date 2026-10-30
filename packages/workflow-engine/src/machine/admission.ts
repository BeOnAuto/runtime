import { Data } from 'effect';

import { callKeyText } from '../executor/call-key.ts';
import { heldValueOf } from './held-values.ts';
import type { RunInput } from './run-input.ts';
import type { RunState } from './run-state.ts';
import { sameJson } from './same-json.ts';

export type StaleReason =
  | 'not_started'
  | 'started_before'
  | 'run_ended'
  | 'timer_not_armed'
  | 'call_not_open'
  | 'event_received_before'
  | 'offer_taken_before'
  | 'listener_not_open'
  | 'offer_declined'
  | 'cancel_requested_before';

export type SubmissionOutcome = 'applied' | 'stale' | 'not_started';

export class RunMismatch extends Data.TaggedError('run_mismatch')<{ readonly detail: string }> {}

function requireSameRun(state: RunState, input: RunInput): void {
  if (input.runId !== state.runId) {
    throw new RunMismatch({ detail: `An input for ${input.runId} reached the run of ${state.runId}` });
  }
}

function startedReason(
  state: RunState,
  input: Extract<RunInput, { readonly kind: 'started' }>,
): StaleReason | undefined {
  if (state.status === 'new') {
    return undefined;
  }
  requireSameRun(state, input);
  if (state.workflow === null || !sameJson(state.workflow.document, input.document)) {
    throw new RunMismatch({ detail: `The run of ${state.runId} was started again with another document` });
  }
  if (!sameJson(heldValueOf(state, state.workflow.input).value, input.input)) {
    throw new RunMismatch({ detail: `The run of ${state.runId} was started again with another input` });
  }
  return 'started_before';
}

function offerReason(
  state: RunState,
  input: Extract<RunInput, { readonly kind: 'event_offered' }>,
): StaleReason | undefined {
  if (state.inbox.offeredIds.includes(input.key)) {
    return 'offer_taken_before';
  }
  return Object.hasOwn(state.listeners, callKeyText(input.listener)) ? undefined : 'listener_not_open';
}

function spentReason(state: RunState, input: Exclude<RunInput, { readonly kind: 'started' }>): StaleReason | undefined {
  if (input.kind === 'timer_fired') {
    return Object.hasOwn(state.timers.armed, input.timerId) ? undefined : 'timer_not_armed';
  }
  if (input.kind === 'call_answered') {
    return Object.hasOwn(state.calls, callKeyText(input.key)) ? undefined : 'call_not_open';
  }
  if (input.kind === 'event_received') {
    return state.inbox.receivedIds.includes(input.event.id) ? 'event_received_before' : undefined;
  }
  if (input.kind === 'event_offered') {
    return offerReason(state, input);
  }
  return state.cancelRequested ? 'cancel_requested_before' : undefined;
}

export function staleReasonOf(state: RunState, input: RunInput): StaleReason | undefined {
  if (input.kind === 'started') {
    return startedReason(state, input);
  }
  if (state.status === 'new') {
    return 'not_started';
  }
  requireSameRun(state, input);
  return state.status === 'ended' ? 'run_ended' : spentReason(state, input);
}

export function outcomeOf(reason?: StaleReason): SubmissionOutcome {
  if (reason === undefined) {
    return 'applied';
  }
  return reason === 'not_started' ? 'not_started' : 'stale';
}
