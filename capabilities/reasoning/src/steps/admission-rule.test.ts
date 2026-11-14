import type { RecordedCall } from '@on.auto/definitions';
import { onlyReads, type ToolMark } from '@on.auto/tool-servers';
import { actingCallsCount, callCountOf, type CallCount } from '@on.auto/tool-servers/policy';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { textResult, toolCallsResult, type ScriptedCall } from '../testing/model-results.ts';
import { answers, type ScriptedReply } from '../testing/scripted-language-model.ts';
import { defaultBounds, stepsOf, toolOf } from '../testing/step-runs.ts';
import { admittedAgain } from './call-admission.ts';
import { stateOfTheAttempt } from './run-steps.ts';

type MarkNow = ToolMark | 'gone';

type Ending = 'error' | 'continue';

interface Scenario {
  readonly ending: Ending;
  readonly most: number | undefined;
  readonly marksThen: readonly ToolMark[];
  readonly marksNow: readonly MarkNow[];
  readonly order: readonly number[];
  readonly startsFirst: boolean;
  readonly slack: number;
}

const prompt = { kind: 'prompt' as const, instructions: 'Answer briefly', message: 'Find acme.' };

const startedAt = new Date().toISOString();

const answered = answers(textResult('Acme has 2 rows.'));

function asking(calls: readonly ScriptedCall[]): ScriptedReply {
  return answers(toolCallsResult(calls));
}

function baseCalls(count: number): readonly ScriptedCall[] {
  return Array.from({ length: count }, (_, call): ScriptedCall => ['graph__base', { query: `base ${call}` }]);
}

function stepCalls(marks: number): readonly ScriptedCall[] {
  return Array.from({ length: marks }, (_, call): ScriptedCall => [`graph__t${call}`, { query: `call ${call}` }]);
}

function countOf(most: number | undefined): CallCount {
  return most === undefined ? actingCallsCount : callCountOf(most);
}

function boundsOf({ ending, most }: Pick<Scenario, 'ending' | 'most'>) {
  return { ...defaultBounds, exitBehavior: ending, count: countOf(most) };
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

function renumbered(call: RecordedCall, number: number): RecordedCall {
  if (call.type === 'tool_call_started') {
    return { ...call, data: { ...call.data, number } };
  }
  return call.type === 'tool_call_answered' ? { ...call, data: { ...call.data, number } } : call;
}

interface Attempt {
  readonly head: readonly RecordedCall[];
  readonly starts: ReadonlyMap<string, RecordedCall>;
  readonly ends: ReadonlyMap<string, RecordedCall>;
  readonly content: ReturnType<typeof stepsOf>['content'];
}

async function firstAttemptOf(scenario: Scenario): Promise<Attempt> {
  const first = stepsOf({
    tools: toolsAt(scenario.marksThen),
    bounds: boundsOf(scenario),
    prompt,
    before: { startedAt, modelCallsBefore: 0, calls: [] },
    replies: [asking(baseCalls(baseOf(scenario))), asking(stepCalls(scenario.marksThen.length)), answered, answered],
  });
  await Effect.runPromise(Effect.exit(first.stepping));
  const calls = first.journal.calls();
  const answeredAt = calls.flatMap((call, at) => (call.type === 'model_call_answered' ? [at] : []))[1] ?? 0;
  const step = calls.slice(answeredAt + 1).filter(({ type }) => type.startsWith('tool_call'));
  const starts = new Map(
    step.flatMap((call) => (call.type === 'tool_call_started' ? [[call.data.call_id, call]] : [])),
  );
  const idOf = new Map([...starts.values()].map((call) => [call.data.number, call.data.call_id]));
  const ends = new Map(
    step.flatMap((call) => (call.type === 'tool_call_started' ? [] : [[String(idOf.get(call.data.number)), call]])),
  );
  return { head: calls.slice(0, answeredAt + 1), starts, ends, content: first.content };
}

function historyOf({ head, starts, ends }: Attempt, { order, startsFirst }: Scenario): readonly RecordedCall[] {
  const firstNumber = Math.min(...[...starts.values()].map(({ data }) => data.number));
  const pairs = order.flatMap((call): readonly (readonly [RecordedCall, RecordedCall])[] => {
    const id = `call-${call + 1}`;
    const [start, end] = [starts.get(id), ends.get(id)];
    return start === undefined || end === undefined ? [] : [[start, end]];
  });
  const numbered = pairs.map(
    ([start, end]: readonly [RecordedCall, RecordedCall], at): readonly [RecordedCall, RecordedCall] => [
      renumbered(start, firstNumber + at),
      renumbered(end, firstNumber + at),
    ],
  );
  const tail = startsFirst
    ? [
        ...numbered.map(([start]: readonly [RecordedCall, RecordedCall]) => start),
        ...numbered.map(([, end]: readonly [RecordedCall, RecordedCall]) => end),
      ]
    : numbered.flat();
  return [...head, ...tail];
}

function answeredIds(calls: readonly RecordedCall[]): readonly string[] {
  const idOf = new Map(
    calls.flatMap((call) => (call.type === 'tool_call_started' ? [[call.data.number, call.data.call_id]] : [])),
  );
  return calls.flatMap((call) => (call.type === 'tool_call_answered' ? [String(idOf.get(call.data.number))] : []));
}

interface Resumed {
  readonly sent: readonly RecordedCall[];
  readonly folded: Awaited<ReturnType<typeof foldOf>>;
}

function foldOf(scenario: Scenario, calls: readonly RecordedCall[], content: Attempt['content']) {
  const again = stepsOf({ tools: toolsAt(scenario.marksNow), bounds: boundsOf(scenario), prompt, content });
  return Effect.runPromise(stateOfTheAttempt(again.run, prompt, { modelCallsBefore: 0, calls }));
}

async function resumedOn(
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
  await Effect.runPromise(again.stepping);
  return {
    sent: again.journal.calls().filter(({ type }) => type === 'tool_call_started'),
    folded: await foldOf(scenario, calls, content),
  } satisfies Resumed;
}

function actingSent(calls: readonly RecordedCall[]): number {
  return calls.filter((call) => call.type === 'tool_call_started' && call.data.read_only !== true).length;
}

function startedIds(calls: readonly RecordedCall[]): readonly string[] {
  return calls.flatMap((call) => (call.type === 'tool_call_started' ? [call.data.call_id] : []));
}

function callsSent(calls: readonly RecordedCall[]): number {
  return new Set(startedIds(calls)).size;
}

function admissionIn({ asking: step, tally }: Pick<Resumed['folded'], 'asking' | 'tally'>) {
  return {
    admitted: step.admitted.map(({ callId, reads }) => `${callId} ${String(reads)}`).toSorted(),
    refused: [...step.refused.keys()].toSorted(),
    counted: tally.counted,
  };
}

async function heldTo(scenario: Scenario): Promise<readonly string[]> {
  const attempt = await firstAttemptOf(scenario);
  const history = historyOf(attempt, scenario);
  const cuts = Array.from({ length: history.length - attempt.head.length + 1 }, (_, at) => attempt.head.length + at);
  const breaks = await Promise.all(
    cuts.map(async (cut) => {
      const calls = history.slice(0, cut);
      const [once, twice] = [
        await resumedOn(scenario, calls, attempt.content),
        await resumedOn(scenario, calls, attempt.content),
      ];
      const everySend = [...calls, ...once.sent];
      const within = scenario.most === undefined ? actingSent(everySend) <= 25 : callsSent(everySend) <= scenario.most;
      const neverRefused = answeredIds(calls.slice(attempt.head.length)).every(
        (id) => !once.folded.asking.refused.has(id) && once.folded.asking.results.has(id),
      );
      const sameDecision =
        JSON.stringify([admissionIn(once.folded), startedIds(once.sent)]) ===
        JSON.stringify([admissionIn(twice.folded), startedIds(twice.sent)]);
      const theRule = admittedAgain(once.folded.asking, { offered: once.folded.offered, count: once.folded.count });
      const asTheRule =
        JSON.stringify(admissionIn(once.folded)) ===
        JSON.stringify(admissionIn({ asking: theRule.asking, tally: theRule.tally }));
      return [within, neverRefused, sameDecision, asTheRule].every(Boolean) ? [] : [JSON.stringify({ scenario, cut })];
    }),
  );
  return breaks.flat();
}

function nextOf(seed: number): number {
  return (seed * 48_271) % 2_147_483_647;
}

function pick<A>(from: readonly [A, ...A[]], drawn: number): A {
  return from[drawn % from.length] ?? from[0];
}

function scenarioOf(drawn: readonly number[]): Scenario {
  const at = (index: number): number => drawn[index] ?? 0;
  const calls = [0, 1, 2, 3];
  return {
    ending: pick<Ending>(['error', 'continue'], at(0)),
    most: pick<number | undefined>([undefined, 5], at(1)),
    marksThen: calls.map((call) => pick<ToolMark>(['acts', 'reads', 'unmarked'], at(2 + call))),
    marksNow: calls.map((call) => pick<MarkNow>(['acts', 'reads', 'unmarked', 'gone'], at(6 + call))),
    order: calls.toSorted((first, second) => (at(10 + first) % 97) - (at(10 + second) % 97)),
    startsFirst: pick([true, false], at(14)),
    slack: pick([0, 0, -1, 1], at(15)),
  };
}

function scenarios(count: number): readonly Scenario[] {
  const drawn = Array.from({ length: count * 16 }).reduce<readonly number[]>(
    (seeds) => [...seeds, nextOf(seeds.at(-1) ?? 20_261_113)],
    [],
  );
  return Array.from({ length: count }, (_, scenario) => scenarioOf(drawn.slice(scenario * 16, scenario * 16 + 16)));
}

describe('a step performed again after one of its tools came to declare that it changes things', () => {
  it('counts the calls its first attempt sent before a call it asked earlier and never sent, which it then refuses', async () => {
    const scenario: Scenario = {
      ending: 'continue',
      most: undefined,
      marksThen: ['reads', 'acts'],
      marksNow: ['acts', 'acts'],
      order: [1, 0],
      startsFirst: false,
      slack: 0,
    };
    const attempt = await firstAttemptOf(scenario);
    const calls = historyOf(attempt, scenario).slice(0, attempt.head.length + 2);
    const { sent, folded } = await resumedOn(scenario, calls, attempt.content);

    expect([startedIds(calls.slice(attempt.head.length)), startedIds(sent)]).toEqual([['call-2'], []]);
    expect([actingSent([...calls, ...sent]), [...folded.asking.refused.keys()], folded.tally.counted]).toEqual([
      25,
      ['call-1'],
      26,
    ]);
  });

  it('counts a read its first attempt left open by what it sends it again as, so the next call that changes things is refused', async () => {
    const scenario: Scenario = {
      ending: 'continue',
      most: undefined,
      marksThen: ['reads'],
      marksNow: ['acts'],
      order: [0],
      startsFirst: true,
      slack: -1,
    };
    const attempt = await firstAttemptOf(scenario);
    const calls = historyOf(attempt, scenario).slice(0, attempt.head.length + 1);
    const more = asking([['graph__base', { query: 'one more' }]]);
    const { sent } = await resumedOn(scenario, calls, attempt.content, [more, answered, answered]);

    expect([startedIds(sent), actingSent(sent)]).toEqual([['call-1'], 1]);
    expect(actingSent([...calls, ...sent])).toBe(25);
  });
});

describe('the admission of a step performed again after its tools changed what they declare', () => {
  it('never sends past the count, never refuses a call sent, and decides the same from the same facts, as the one rule does', async () => {
    const broken = await Promise.all(scenarios(120).map((scenario) => heldTo(scenario)));

    expect(broken.flat()).toEqual([]);
  }, 120_000);
});
