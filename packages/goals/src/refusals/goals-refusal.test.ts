import { InvalidInput } from '@on.auto/operations';
import { internalTermsIn } from '@on.auto/operations/testing';
import { goalsWantedWordsOf } from '@on.auto/playbooks';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { goalsCheckedWhere, goalsRefusalOf, savedGoalsRefusalOf } from '../index.ts';

const naming = { name: 'Growth' };

const goal = {
  id: 'first-customer',
  statement: 'Land the first paying customer.',
  success: {
    label: 'Paying customers',
    settles: 'on_crossing',
    target: { at_least: 1 },
    passed: 'Landed',
    failed: 'Missed',
  },
  notify: { passed: 'quiet', failed: 'quiet' },
};

function checking(goals: unknown, messages = true) {
  return goalsCheckedWhere(messages)(JSON.stringify(goals), naming).pipe(Effect.provide(TestClock.layer()));
}

function refusalOf(goals: unknown, messages = true) {
  return Effect.runPromise(Effect.flip(checking(goals, messages)));
}

async function detailsOf(goals: unknown): Promise<readonly string[]> {
  const { detail, issues } = await refusalOf(goals);
  return [detail, ...issues.map((issue) => issue.detail)];
}

const encoder = new TextEncoder();

describe('the check of goals as an effect', () => {
  it('answers goals that hold with their document', async () => {
    expect(await Effect.runPromise(checking([goal]))).toMatchObject({ goals: [{ id: 'first-customer' }] });
  });
});

describe('the refusal of goals', () => {
  it("leads with the person's question and says where the answer goes when no goals were given", async () => {
    expect(await refusalOf([])).toMatchObject({
      _tag: 'invalid_input',
      detail: goalsWantedWordsOf(true),
      issues: [{ pointer: '/goals' }],
    });
    expect(goalsWantedWordsOf(true)).toContain('the goals argument of update_playbook or create_playbook');
    expect(goalsWantedWordsOf(true)).toContain('the goals guide');
  });

  it("leads with the first question only the person can answer, before the agent's problems", async () => {
    const refusal = await refusalOf([
      { ...goal, id: 'X', statement: undefined, success: { ...goal.success, label: undefined } },
    ]);

    expect(refusal.detail).toBe(
      'Ask the person: What change do you want from this? The goals have 3 problems, which the issues name.',
    );
    expect(refusal.issues.map(({ pointer }) => pointer)).toEqual([
      '/goals/0/id',
      '/goals/0/statement',
      '/goals/0/success/label',
    ]);
    expect(refusal.issues[1]?.detail).toMatch(/^Ask the person: What change do you want from this\? /u);
  });

  it("says the agent's problems are the agent's to put right, counting one or many", async () => {
    expect((await refusalOf([{ ...goal, id: 'X' }])).detail).toBe(
      "The goals have one problem, which the issues name; each is the agent's to put right.",
    );
    expect(
      goalsRefusalOf(
        [
          { pointer: '', detail: 'One', fixed_by: 'agent' },
          { pointer: '/0', detail: 'Two', fixed_by: 'agent' },
        ],
        false,
      ),
    ).toMatchObject({
      detail: "The goals have 2 problems, which the issues name; each is the agent's to put right.",
      issues: [
        { pointer: '/goals', detail: 'One' },
        { pointer: '/goals/0', detail: 'Two' },
      ],
    });
  });
});

describe('the refusal of goals where messages are off', () => {
  it('asks nothing about being told when no goals were given where messages are off', async () => {
    const { detail } = await refusalOf([], false);

    expect(detail).toBe(goalsWantedWordsOf(false));
    expect(detail).not.toMatch(/\btell\b|\btold\b/u);
  });
});

describe('the words of the refusal of goals', () => {
  it('fits every detail in 256 bytes, with none of the internal terms', async () => {
    const cases: readonly unknown[] = [
      [],
      [{ ...goal, statement: 'Growth' }],
      [{ ...goal, notify: {} }],
      [{ ...goal, notify: { passed: 'now', failed: 'summary' } }],
      [{ ...goal, id: 'X' }],
    ];
    const details = (await Promise.all(cases.map((goals) => detailsOf(goals)))).flat();

    expect(details.length).toBeGreaterThan(cases.length);
    expect(details.filter((detail) => encoder.encode(detail).length > 256)).toEqual([]);
    expect(details.flatMap((detail) => internalTermsIn(detail))).toEqual([]);
  });
});

describe('a refusal of the save of goals against those saved before', () => {
  it('keeps its words and puts its issues under the goals argument', () => {
    const refused = new InvalidInput({
      detail: 'These goals cannot replace the goals saved before',
      issues: [
        { pointer: '/0/per', detail: 'The goal first-customer cannot change what it is judged per once saved' },
        { pointer: '', detail: 'The goal kept-customers has been judged and cannot be left out' },
      ],
    });

    expect(savedGoalsRefusalOf(refused)).toEqual(
      new InvalidInput({
        detail: 'These goals cannot replace the goals saved before',
        issues: [
          { pointer: '/goals/0/per', detail: 'The goal first-customer cannot change what it is judged per once saved' },
          { pointer: '/goals', detail: 'The goal kept-customers has been judged and cannot be left out' },
        ],
      }),
    );
  });
});
