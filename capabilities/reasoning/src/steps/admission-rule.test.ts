import type { RecordedCall } from '@on.auto/definitions';
import type { ToolMark } from '@on.auto/tool-servers';
import { describe, expect, it } from 'vitest';

import {
  type Attempt,
  type MarkNow,
  type Scenario,
  actingSent,
  actingSentOnce,
  admissionIn,
  answered,
  answeredIds,
  asTheRuleGives,
  asking,
  endsAsTheOutcomeUnknown,
  firstAttemptOf,
  historyOf,
  resumedOn,
  startedIds,
  withinTheCount,
} from '../testing/step-histories.ts';

async function heldOnceMore(
  scenario: Scenario,
  before: readonly RecordedCall[],
  content: Attempt['content'],
): Promise<boolean> {
  const third = await resumedOn(scenario, before, content);
  const everySend = [...before, ...third.sent];
  const held = [withinTheCount(scenario, everySend), actingSentOnce(everySend), endsAsTheOutcomeUnknown(before, third)];
  return [...held, asTheRuleGives(third.folded)].every(Boolean);
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
      const neverRefused = answeredIds(calls.slice(attempt.head.length)).every(
        (id) => !once.folded.asking.refused.has(id) && once.folded.asking.results.has(id),
      );
      const sameDecision =
        JSON.stringify([admissionIn(once.folded), startedIds(once.sent)]) ===
        JSON.stringify([admissionIn(twice.folded), startedIds(twice.sent)]);
      const cutAgain = await Promise.all(
        once.calls.map((_, at) => heldOnceMore(scenario, [...calls, ...once.calls.slice(0, at + 1)], attempt.content)),
      );
      const held = [
        withinTheCount(scenario, everySend),
        actingSentOnce(everySend),
        endsAsTheOutcomeUnknown(calls, once),
        neverRefused,
        sameDecision,
      ];
      return [...held, asTheRuleGives(once.folded), ...cutAgain].every(Boolean)
        ? []
        : [JSON.stringify({ scenario, cut })];
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
    ending: pick<Scenario['ending']>(['error', 'continue'], at(0)),
    most: pick<number | undefined>([undefined, 5], at(1)),
    marksThen: calls.map((call) => pick<ToolMark>(['acts', 'reads', 'unmarked'], at(2 + call))),
    marksNow: calls.map((call) => pick<MarkNow>(['acts', 'reads', 'unmarked', 'gone'], at(6 + call))),
    order: calls.toSorted((first, second) => (at(10 + first) % 97) - (at(10 + second) % 97)),
    startsFirst: pick([true, false], at(14)),
    slack: pick([0, 0, -1, 1], at(15)),
  };
}

function scenarioWith(given: Pick<Scenario, 'marksThen' | 'marksNow' | 'order' | 'startsFirst' | 'slack'>): Scenario {
  return { ending: 'continue', most: undefined, ...given };
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
    const scenario = scenarioWith({
      marksThen: ['reads', 'acts'],
      marksNow: ['acts', 'acts'],
      order: [1, 0],
      startsFirst: false,
      slack: 0,
    });
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
    const scenario = scenarioWith({
      marksThen: ['reads'],
      marksNow: ['acts'],
      order: [0],
      startsFirst: true,
      slack: -1,
    });
    const attempt = await firstAttemptOf(scenario);
    const calls = historyOf(attempt, scenario).slice(0, attempt.head.length + 1);
    const more = asking([['graph__base', { query: 'one more' }]]);
    const { sent } = await resumedOn(scenario, calls, attempt.content, [more, answered, answered]);

    expect([startedIds(sent), actingSent(sent)]).toEqual([['call-1'], 1]);
    expect(actingSent([...calls, ...sent])).toBe(25);
  });
});

describe('a step performed again after its first attempt started a call that may change something and recorded no answer', () => {
  it('ends with the outcome of that call unknown, not at the count its tools now reach, under exit_behavior error', async () => {
    const scenario: Scenario = {
      ...scenarioWith({
        marksThen: ['acts', 'reads'],
        marksNow: ['acts', 'acts'],
        order: [0, 1],
        startsFirst: true,
        slack: 0,
      }),
      ending: 'error',
    };
    const attempt = await firstAttemptOf(scenario);
    const calls = historyOf(attempt, scenario).slice(0, attempt.head.length + 1);
    const resumed = await resumedOn(scenario, calls, attempt.content);

    expect([startedIds(calls.slice(attempt.head.length)), resumed.folded.tally.counted]).toEqual([['call-1'], 26]);
    expect([resumed.ending, resumed.sent, resumed.calls.map(({ type }) => type)]).toEqual([
      'outcome_unknown',
      [],
      ['tool_call_failed'],
    ]);
  });
});

describe('the admission of a step performed again after its tools changed what they declare', () => {
  it('never sends past the count nor a call that may change something twice, ends the run with the outcome unknown and calls no model once such a call has a start and no answer, never refuses a call sent, and decides the same from the same facts, as the one rule does, at every cut and at every cut of the attempt that resumed it', async () => {
    const broken = await Promise.all(scenarios(120).map((scenario) => heldTo(scenario)));

    expect(broken.flat()).toEqual([]);
  }, 120_000);
});
