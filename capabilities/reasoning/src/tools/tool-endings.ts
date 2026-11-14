import { Conflict, Unavailable, type IncompleteDetails, type RejectionBecause } from '@on.auto/operations';
import type { CallsEndedBecause } from '@on.auto/tool-servers';
import { askedPastTheCount, type CallCount, type CallTally } from '@on.auto/tool-servers/policy';
import { Effect, type Schema } from 'effect';

import { mostToolCalls } from '../definition/definition-settings.ts';
import { leavesNoNextTurn, type Meter, type TurnLimits } from './turn-meter.ts';

type UnfinishedBecause = Extract<
  RejectionBecause,
  | 'server_failed'
  | 'model_unavailable'
  | 'definition_refused'
  | 'run_bound'
  | 'no_answer'
  | 'restarted_without_content'
  | 'call_outcome_unknown'
>;

const serverEndings = {
  failing: 'A tool server kept failing',
  rate_limited: 'A tool server kept asking the run to slow down for longer than it waits',
} as const;

export type ToolsStoppedBecause = 'server_failed' | 'run_bound' | 'no_answer';

export type LimitReached =
  | { readonly type: 'limit_reached'; readonly because: 'max_tool_calls'; readonly count: CallCount }
  | { readonly type: 'limit_reached'; readonly because: 'max_input_tokens'; readonly limit: number };

export interface ToolUse {
  readonly calledAny: boolean;
  readonly onlyRead: boolean;
  readonly inWords: string;
  readonly ending: CallsEndedBecause | null;
}

export interface Spent {
  readonly record?: Schema.JsonObject;
}

export const counted = new Intl.NumberFormat('en');

function unfinished(use: ToolUse, because: UnfinishedBecause, detail: string, spent: Spent): Unavailable | Conflict {
  const ending = { detail: `${detail}, after the run called ${use.inWords}`, because, ...spent };
  return use.onlyRead
    ? new Unavailable({ ...ending, kind: 'tools_unfinished' })
    : new Conflict({ ...ending, kind: 'effect_unknown' });
}

export interface Stopped {
  readonly detail: string;
  readonly because: ToolsStoppedBecause;
}

function stoppedDetail({ ending }: ToolUse, stopped: Stopped): string {
  return ending === null ? stopped.detail : serverEndings[ending];
}

export function stoppedEnding(
  use: ToolUse | undefined,
  stopped: Stopped,
  spent: Spent = {},
): Effect.Effect<never, Unavailable | Conflict> {
  return Effect.fail(
    use?.calledAny === true
      ? unfinished(use, stopped.because, stoppedDetail(use, stopped), spent)
      : new Unavailable({ detail: stopped.detail, ...spent }),
  );
}

export function unavailableAfter(
  use: ToolUse | undefined,
  detail: string,
  advice: string,
  spent: Spent = {},
): Effect.Effect<never, Unavailable | Conflict> {
  return Effect.fail(
    use?.calledAny === true
      ? unfinished(use, 'model_unavailable', detail, spent)
      : new Unavailable({ detail: `${detail}${advice}`, ...spent }),
  );
}

export function unfinishedAfter(
  use: ToolUse,
  because: Extract<
    UnfinishedBecause,
    'server_failed' | 'definition_refused' | 'restarted_without_content' | 'call_outcome_unknown'
  >,
  detail: string,
  spent: Spent,
): Effect.Effect<never, Unavailable | Conflict> {
  return Effect.fail(
    use.calledAny ? unfinished(use, because, detail, spent) : new Unavailable({ detail, because, ...spent }),
  );
}

function moreCallsThanItsCount({ most, countsReads }: CallCount): string {
  return countsReads
    ? `The run needed more than the ${counted.format(most)} tool calls its function's max_tool_calls lets a run make`
    : `The run needed more than the ${counted.format(most)} calls a run may make of tools not marked reads`;
}

function toolCallsToChange({ most, countsReads }: CallCount): string {
  const atMost = counted.format(mostToolCalls);
  if (!countsReads) {
    return `Set max_tool_calls in the reasoning function definition to give the run a count of its own, of all its calls, to at most ${atMost}, or run the function once for each item from a workflow`;
  }
  return most < mostToolCalls
    ? `Raise max_tool_calls in the reasoning function definition, to at most ${atMost}, or run the function once for each item from a workflow`
    : 'Run the function once for each item from a workflow, so each run makes the calls of one item';
}

const askForLess =
  'Ask each tool for less, such as one page of what it holds, or run the function once for each item from a workflow';

const answerFromWhatItHas =
  'to have it answer from what it has instead, where an answer from part of the work will do, set exit_behavior: continue in the reasoning function definition';

function calledIn({ calledAny, inWords }: ToolUse): string {
  return calledAny ? `, after the run called ${inWords}` : '';
}

function limitInWords(reached: LimitReached): { readonly needed: string; readonly change: string } {
  return reached.because === 'max_tool_calls'
    ? { needed: moreCallsThanItsCount(reached.count), change: toolCallsToChange(reached.count) }
    : {
        needed: `The run needed more than the ${counted.format(reached.limit)} input tokens a run may read`,
        change: askForLess,
      };
}

export function limitEnding(use: ToolUse, reached: LimitReached, spent: Spent): Effect.Effect<never, Conflict> {
  const { needed, change } = limitInWords(reached);
  const detail = `${needed}${calledIn(use)}. ${change}; ${answerFromWhatItHas}`;
  const kind = use.onlyRead ? 'unworkable' : 'effect_unknown';
  return Effect.fail(new Conflict({ detail, kind, because: reached.because, ...spent }));
}

interface LastStepMade {
  readonly tally: CallTally;
  readonly count: CallCount;
  readonly meterBeforeLastCall: Meter;
}

function withheldByTheBudget({ tally, count, meterBeforeLastCall }: LastStepMade, limits: TurnLimits): boolean {
  return !askedPastTheCount(tally, count) && leavesNoNextTurn(meterBeforeLastCall, limits);
}

export function answeredAtALimit(last: LastStepMade, limits: TurnLimits): IncompleteDetails {
  return { reason: withheldByTheBudget(last, limits) ? 'max_input_tokens' : 'max_tool_calls' };
}
