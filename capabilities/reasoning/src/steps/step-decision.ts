import { askedPastTheCount, type CallCount } from '@on.auto/tool-servers/policy';
import type { Schema } from 'effect';

import type { ExitBehavior } from '../definition/front-matter-schema.ts';
import { finalStepMessages } from '../tools/final-step.ts';
import type { LimitReached, ToolsStoppedBecause } from '../tools/tool-endings.ts';
import { leavesNoNextTurn, roomOfEachAnswer, type TurnLimits } from '../tools/turn-meter.ts';
import {
  isAnswered,
  onlyReadsWithoutAnAnswer,
  resultsMessage,
  unsent,
  type AdmittedCall,
  type Asking,
} from './asked-calls.ts';
import { openModelCallOf, type FactData } from './attempt-facts.ts';
import { promptMessages, type StepMessages } from './step-messages.ts';
import { withItsAdmission, type StepEnding, type StepState } from './step-state.ts';

export interface StepBounds {
  readonly runBoundMs: number;
  readonly limits: TurnLimits;
  readonly count: CallCount;
  readonly exitBehavior: ExitBehavior;
}

export interface Deciding {
  readonly bounds: StepBounds;
  readonly elapsedMs: number;
  readonly fence: string;
  readonly provider: string;
}

export function runBoundWords(runBoundMs: number): string {
  return `The run went on for ${runBoundMs} ms, the longest a run that calls tools may take`;
}

export interface ModelCallNext {
  readonly type: 'model_call';
  readonly sent: StepMessages;
  readonly final: boolean;
  readonly remade: number | null;
}

export interface ToolCallsNext {
  readonly type: 'tool_calls';
  readonly calls: readonly AdmittedCall[];
  readonly room: number | undefined;
}

type FailedData = FactData<'model_call_failed'>;

export type FailedCall = Omit<FailedData, 'because'> & {
  readonly because: Exclude<FailedData['because'], 'cancelled' | 'interrupted'>;
};

export type NextStep =
  | ModelCallNext
  | ToolCallsNext
  | Extract<StepEnding, { readonly type: 'answered' }>
  | { readonly type: 'failed'; readonly data: FailedCall }
  | { readonly type: 'stopped'; readonly because: ToolsStoppedBecause; readonly detail: string }
  | LimitReached
  | { readonly type: 'outcome_unknown' }
  | { readonly type: 'unreadable' };

function isRecordedFailure(data: FailedData): data is FailedCall {
  return data.because !== 'cancelled';
}

function endingOf(ending: Extract<StepEnding, { readonly type: 'failed' }>): NextStep {
  return isRecordedFailure(ending.data)
    ? { type: 'failed', data: ending.data }
    : { type: 'stopped', because: 'run_bound', detail: ending.data.detail };
}

type Stop = Extract<NextStep, { readonly type: 'stopped' | 'outcome_unknown' }> | LimitReached;

function limitReached(state: StepState, { limits, exitBehavior }: StepBounds): LimitReached | undefined {
  if (exitBehavior === 'continue' || state.asking.asked.length === 0) {
    return undefined;
  }
  if (askedPastTheCount(state.tally, state.count)) {
    return { type: 'limit_reached', because: 'max_tool_calls', count: state.count };
  }
  return leavesNoNextTurn(state.meterBeforeLastCall, limits)
    ? { type: 'limit_reached', because: 'max_input_tokens', limit: limits.mostInputTokens }
    : undefined;
}

function stoppedBy(state: StepState, { bounds, elapsedMs, provider }: Deciding): Stop | undefined {
  if (!onlyReadsWithoutAnAnswer(state.asking)) {
    return { type: 'outcome_unknown' };
  }
  if (state.asking.final && state.asking.asked.length > 0) {
    const detail = `${provider} kept calling tools in the step that withheld them, instead of answering`;
    return { type: 'stopped', because: 'no_answer', detail };
  }
  if (elapsedMs >= bounds.runBoundMs) {
    return { type: 'stopped', because: 'run_bound', detail: runBoundWords(bounds.runBoundMs) };
  }
  return state.serversEnded === null
    ? limitReached(state, bounds)
    : { type: 'stopped', because: 'server_failed', detail: 'Its tool servers failed too often' };
}

function toolCallsOf(state: StepState, asking: Asking, bounds: StepBounds): ToolCallsNext {
  return { type: 'tool_calls', calls: unsent(asking), room: roomOfEachAnswer(state.meter, bounds.limits) };
}

function isFinal(state: StepState, { limits, exitBehavior }: StepBounds): boolean {
  return (
    exitBehavior === 'continue' &&
    (askedPastTheCount(state.tally, state.count) || leavesNoNextTurn(state.meter, limits))
  );
}

function nextModelCall(state: StepState, { bounds, fence }: Deciding): ModelCallNext {
  const open = openModelCallOf(state.facts);
  if (open !== null) {
    return { type: 'model_call', sent: state.lastSent, final: state.lastFinal, remade: open };
  }
  if (state.asking.asked.length === 0) {
    return { type: 'model_call', sent: state.prompt, final: false, remade: null };
  }
  const final = isFinal(state, bounds);
  const messages: readonly Schema.JsonObject[] = [resultsMessage(state.asking)];
  return final
    ? {
        type: 'model_call',
        sent: {
          kind: 'retold',
          messages: finalStepMessages(promptMessages(state.prompt), [...state.conversation, ...messages], fence),
        },
        final,
        remade: null,
      }
    : { type: 'model_call', sent: { kind: 'results', messages }, final, remade: null };
}

export function nextStep(folded: StepState, deciding: Deciding): NextStep {
  const state = withItsAdmission(folded);
  if (state.ending?.type === 'answered') {
    return state.ending;
  }
  if (state.unreadable || state.asking.unread.length > 0) {
    return { type: 'unreadable' };
  }
  if (state.ending !== null) {
    return endingOf(state.ending);
  }
  const stopped = stoppedBy(state, deciding);
  if (stopped !== undefined) {
    return stopped;
  }
  return openModelCallOf(state.facts) === null && (!isAnswered(state.asking) || state.asking.open.length > 0)
    ? toolCallsOf(state, state.asking, deciding.bounds)
    : nextModelCall(state, deciding);
}
