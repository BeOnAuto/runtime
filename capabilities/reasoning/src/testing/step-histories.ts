import type { RecordedCall } from '@on.auto/definitions';
import { onlyReads, type ToolMark } from '@on.auto/tool-servers';
import { callCountOf } from '@on.auto/tool-servers/policy';
import { Effect } from 'effect';

import { admittedAgain } from '../steps/call-admission.ts';
import { stateOfTheAttempt } from '../steps/run-steps.ts';
import type { Stepped } from '../steps/step-loop.ts';
import { textResult, toolCallsResult, type ScriptedCall } from './model-results.ts';
import { answers, type ScriptedReply } from './scripted-language-model.ts';
import { defaultBounds, stepsOf, toolOf } from './step-runs.ts';

export type MarkNow = ToolMark | 'gone';

export interface Scenario {
  readonly ending: 'error' | 'continue';
  readonly most: number | undefined;
  readonly marksThen: readonly ToolMark[];
  readonly marksNow: readonly MarkNow[];
  readonly order: readonly number[];
  readonly startsFirst: boolean;
  readonly slack: number;
}

const prompt = { kind: 'prompt' as const, instructions: 'Answer briefly', message: 'Find acme.' };

const startedAt = new Date().toISOString();

export const answered = answers(textResult('Acme has 2 rows.'));

export function asking(calls: readonly ScriptedCall[]): ScriptedReply {
  return answers(toolCallsResult(calls));
}

function callsOf(count: number, tool?: string): readonly ScriptedCall[] {
  return Array.from({ length: count }, (_, call): ScriptedCall => [
    `graph__${tool ?? `t${call}`}`,
    { query: `${call}` },
  ]);
}

function boundsOf({ ending, most }: Pick<Scenario, 'ending' | 'most'>) {
  return { ...defaultBounds, exitBehavior: ending, count: callCountOf(most) };
}

function toolsAt(marks: readonly MarkNow[]) {
  const offered = marks.flatMap((mark, call) =>
    mark === 'gone' ? [] : [toolOf('graph', `t${call}`, onlyReads({ mark }))],
  );
  return [toolOf('graph', 'base', false), ...offered];
}

function baseOf({ most, marksThen, slack }: Pick<Scenario, 'most' | 'marksThen' | 'slack'>): number {
  const counted = most === undefined ? marksThen.filter((mark) => !onlyReads({ mark })).length : marksThen.length;
  return Math.max(0, (most ?? 25) - counted + slack);
}

type Started = Extract<RecordedCall, { readonly type: 'tool_call_started' }>;

type Answered = Extract<RecordedCall, { readonly type: 'tool_call_answered' }>;

function startedAs(call: Started, number: number): Started {
  return { ...call, data: { ...call.data, number } };
}

function answeredAs(call: Answered, number: number): Answered {
  return { ...call, data: { ...call.data, number } };
}

export interface Attempt {
  readonly head: readonly RecordedCall[];
  readonly starts: ReadonlyMap<string, Started>;
  readonly ends: ReadonlyMap<string, Answered>;
  readonly content: ReturnType<typeof stepsOf>['content'];
}

export async function firstAttemptOf(scenario: Scenario): Promise<Attempt> {
  const first = stepsOf({
    tools: toolsAt(scenario.marksThen),
    bounds: boundsOf(scenario),
    prompt,
    before: { startedAt, modelCallsBefore: 0, calls: [] },
    replies: [
      asking(callsOf(baseOf(scenario), 'base')),
      asking(callsOf(scenario.marksThen.length)),
      answered,
      answered,
    ],
  });
  await Effect.runPromise(Effect.exit(first.stepping));
  const calls = first.journal.calls();
  const answeredAt = calls.findIndex(
    (call, at) => call.type === 'model_call_answered' && calls.slice(0, at).some(({ type }) => type === call.type),
  );
  const step = calls.slice(answeredAt + 1);
  const idOf = idsByNumber(step);
  const starts = new Map(
    step.flatMap((call) => (call.type === 'tool_call_started' ? [[call.data.call_id, call]] : [])),
  );
  const ends = new Map(
    step.flatMap((call) => (call.type === 'tool_call_answered' ? [[String(idOf.get(call.data.number)), call]] : [])),
  );
  return { head: calls.slice(0, answeredAt + 1), starts, ends, content: first.content };
}

export function historyOf({ head, starts, ends }: Attempt, { order, startsFirst }: Scenario): readonly RecordedCall[] {
  const firstNumber = Math.min(...[...starts.values()].map(({ data }) => data.number));
  const pairs = order.flatMap((call): readonly (readonly [Started, Answered])[] => {
    const id = `call-${call + 1}`;
    const [start, end] = [starts.get(id), ends.get(id)];
    return start === undefined || end === undefined ? [] : [[start, end]];
  });
  const numbered = pairs.map(([start, end]: readonly [Started, Answered], at): readonly [Started, Answered] => [
    startedAs(start, firstNumber + at),
    answeredAs(end, firstNumber + at),
  ]);
  const tail = startsFirst
    ? [
        ...numbered.map(([start]: readonly [Started, Answered]) => start),
        ...numbered.map(([, end]: readonly [Started, Answered]) => end),
      ]
    : numbered.flat();
  return [...head, ...tail];
}

function idsByNumber(calls: readonly RecordedCall[]): ReadonlyMap<number, string> {
  return new Map(
    calls.flatMap((call) => (call.type === 'tool_call_started' ? [[call.data.number, call.data.call_id]] : [])),
  );
}

export function answeredIds(calls: readonly RecordedCall[]): readonly string[] {
  const idOf = idsByNumber(calls);
  return calls.flatMap((call) => (call.type === 'tool_call_answered' ? [String(idOf.get(call.data.number))] : []));
}

interface Resumed {
  readonly calls: readonly RecordedCall[];
  readonly sent: readonly RecordedCall[];
  readonly folded: Awaited<ReturnType<typeof foldOf>>;
  readonly ending: Stepped['ending']['type'];
}

function foldOf(scenario: Scenario, calls: readonly RecordedCall[], content: Attempt['content']) {
  const again = stepsOf({ tools: toolsAt(scenario.marksNow), bounds: boundsOf(scenario), prompt, content });
  return Effect.runPromise(stateOfTheAttempt(again.run, prompt, { modelCallsBefore: 0, calls }));
}

export async function resumedOn(
  scenario: Scenario,
  calls: readonly RecordedCall[],
  content: Attempt['content'],
  replies: readonly ScriptedReply[] = [answered, answered, answered],
) {
  const again = stepsOf({
    tools: toolsAt(scenario.marksNow),
    bounds: boundsOf(scenario),
    prompt,
    content,
    before: { startedAt, modelCallsBefore: 0, calls },
    replies,
  });
  const { ending } = await Effect.runPromise(again.stepping);
  return {
    calls: again.journal.calls(),
    sent: again.journal.calls().filter(({ type }) => type === 'tool_call_started'),
    folded: await foldOf(scenario, calls, content),
    ending: ending.type,
  } satisfies Resumed;
}

function callsOfTheLastStep(calls: readonly RecordedCall[]): readonly RecordedCall[] {
  return calls.slice(calls.findLastIndex(({ type }) => type === 'model_call_answered') + 1);
}

function actingWithoutAnAnswer(calls: readonly RecordedCall[]): readonly string[] {
  const step = callsOfTheLastStep(calls);
  const idOf = idsByNumber(step);
  const answeredInStep = new Set(
    step.flatMap((call) =>
      call.type === 'tool_call_answered' || (call.type === 'tool_call_failed' && call.data.because !== 'interrupted')
        ? [idOf.get(call.data.number)]
        : [],
    ),
  );
  return step.flatMap((call) =>
    call.type === 'tool_call_started' && call.data.read_only !== true && !answeredInStep.has(call.data.call_id)
      ? [call.data.call_id]
      : [],
  );
}

export function endsAsTheOutcomeUnknown(before: readonly RecordedCall[], { calls, ending }: Resumed): boolean {
  const noModelCall = calls.every(({ type }) => type !== 'model_call_started');
  return actingWithoutAnAnswer(before).length === 0 || (ending === 'outcome_unknown' && noModelCall);
}

export function actingSent(calls: readonly RecordedCall[]): number {
  return calls.filter((call) => call.type === 'tool_call_started' && call.data.read_only !== true).length;
}

export function startedIds(calls: readonly RecordedCall[]): readonly string[] {
  return calls.flatMap((call) => (call.type === 'tool_call_started' ? [call.data.call_id] : []));
}

function callsSent(calls: readonly RecordedCall[]): number {
  return new Set(startedIds(calls)).size;
}

export function withinTheCount({ most }: Pick<Scenario, 'most'>, everySend: readonly RecordedCall[]): boolean {
  return most === undefined ? actingSent(everySend) <= 25 : callsSent(everySend) <= most;
}

export function actingSentOnce(everySend: readonly RecordedCall[]): boolean {
  const acting = everySend.flatMap((call) =>
    call.type === 'tool_call_started' && call.data.read_only !== true ? [`${call.data.tool} ${call.data.call_id}`] : [],
  );
  return new Set(acting).size === acting.length;
}

export function admissionIn({ asking: step, tally }: Pick<Resumed['folded'], 'asking' | 'tally'>) {
  return {
    admitted: step.admitted.map(({ callId, reads }) => `${callId} ${String(reads)}`).toSorted(),
    refused: [...step.refused.keys()].toSorted(),
    counted: tally.counted,
  };
}

export function asTheRuleGives(folded: Resumed['folded']): boolean {
  const theRule = admittedAgain(folded.asking, { offered: folded.offered, count: folded.count });
  const same =
    JSON.stringify(admissionIn(folded)) ===
    JSON.stringify(admissionIn({ asking: theRule.asking, tally: theRule.tally }));
  return folded.asking.asked.length === 0 || same;
}
