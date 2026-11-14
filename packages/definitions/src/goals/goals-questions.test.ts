import { internalTermsIn } from '@on.auto/operations/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { PlaybookNaming } from './goal-check.ts';
import { controls, experiments, oneOff, textOf, without } from './goal-examples.ts';
import { goalQuestions, isAskedOfThePerson, type GoalIssue, type GoalQuestion } from './goal-issues.ts';
import { goalsDocumentOf, type GoalsChecking } from './goals-check.ts';

function issuesOf(source: string, checking?: GoalsChecking): readonly GoalIssue[] {
  const issues = Result.match(goalsDocumentOf(source, checking), { onSuccess: () => [], onFailure: (found) => found });
  for (const { detail } of issues) {
    expect(new TextEncoder().encode(detail).length).toBeLessThanOrEqual(256);
    expect(internalTermsIn(detail)).toEqual([]);
  }
  return issues;
}

function issuesOfGoal(goal: unknown, checking?: GoalsChecking): readonly GoalIssue[] {
  return issuesOf(textOf([goal]), checking);
}

function expectAsked(question: GoalQuestion, issue: GoalIssue | undefined, pointer: string): void {
  expect(issue).toMatchObject({ pointer, fixed_by: 'person', ask: goalQuestions[question] });
  expect(issue !== undefined && isAskedOfThePerson(issue)).toBe(true);
  expect(issue?.detail.startsWith(`Ask the person: ${goalQuestions[question]} `)).toBe(true);
}

type Path = readonly [string, ...string[]];

describe('the question of what the playbook should achieve', () => {
  it.each(['', '[]', 'null', '# nothing yet'])('is asked when no goals are given: %j', (source) => {
    const [issue, ...rest] = issuesOf(source);

    expectAsked('purpose', issue, '');
    expect(rest).toEqual([]);
  });
});

const repeatedNamings: readonly (readonly [string, Readonly<PlaybookNaming>])[] = [
  ['name', { name: 'Bring in paying customers, through my experiments' }],
  ['description', { name: 'Growth', description: 'bring in PAYING customers through my experiments!' }],
];

describe('the question of what change is wanted', () => {
  it('is asked where a goal has no statement', () => {
    const [issue, ...rest] = issuesOfGoal(without(experiments, ['statement']));

    expectAsked('change', issue, '/0/statement');
    expect(rest).toEqual([]);
  });

  it.each(['', '   '])('is asked where a goal has a blank statement: %j', (statement) => {
    const [issue, ...rest] = issuesOfGoal({ ...experiments, statement });

    expectAsked('change', issue, '/0/statement');
    expect(rest).toEqual([]);
  });

  it.each(repeatedNamings)(
    "is asked where the statement only repeats the playbook's %s, ignoring case, spaces and punctuation",
    (_, naming) => {
      const [issue, ...rest] = issuesOfGoal(experiments, { naming });

      expectAsked('change', issue, '/0/statement');
      expect(rest).toEqual([]);
    },
  );

  it('is not asked where the statement says something of its own', () => {
    expect(issuesOfGoal(experiments, { naming: { name: 'Growth', description: 'Our experiments' } })).toEqual([]);
  });
});

const unconvincing: readonly (readonly [string, Path])[] = [
  ['success', ['success']],
  ['target', ['success', 'target']],
  ['words for passing', ['success', 'passed']],
  ['words for failing', ['success', 'failed']],
  ['words for its number', ['success', 'label']],
];

describe('the question of what would convince the person', () => {
  it.each(unconvincing)('is asked where a goal has no %s', (_, path) => {
    const [issue, ...rest] = issuesOfGoal(without(experiments, path));

    expectAsked('conviction', issue, `/0/${path.join('/')}`);
    expect(rest).toEqual([]);
  });

  it.each(['label', 'passed', 'failed'])('is asked where the success %s is left blank', (key) => {
    const [issue, ...rest] = issuesOfGoal({ ...experiments, success: { ...experiments.success, [key]: ' ' } });

    expectAsked('conviction', issue, `/0/success/${key}`);
    expect(rest).toEqual([]);
  });
});

const unheard: readonly (readonly [string, Path])[] = [
  ['way to hear of a pass', ['notify', 'passed']],
  ['way to hear of a failure', ['notify', 'failed']],
  ['way to hear that a goal with a window went quiet', ['notify', 'overdue']],
];

describe('the question of how the person wants to hear', () => {
  it.each(unheard)('is asked where a goal has no %s', (_, path) => {
    const [issue, ...rest] = issuesOfGoal(without(experiments, path));

    expectAsked('hearing', issue, `/0/${path.join('/')}`);
    expect(rest).toEqual([]);
  });

  it('is not asked of going quiet for a goal with no window, which can never be overdue', () => {
    expect(issuesOfGoal(oneOff)).toEqual([]);
  });

  it('is not asked of a goal that leaves notify out, which owes the person nothing', () => {
    expect(issuesOfGoal(without(experiments, ['notify']))).toEqual([]);
    expect(issuesOfGoal(without(controls, ['notify']))).toEqual([]);
  });
});

describe('the question of where to tell the person', () => {
  it('is asked when a change is told at once and no function is named', () => {
    const issues = issuesOfGoal(without(controls, ['notify', 'through']));

    expect(issues.map(({ pointer }) => pointer).toSorted()).toEqual(['/0/notify/summary/through', '/0/notify/through']);
    for (const issue of issues) {
      expectAsked('channel', issue, issue.pointer);
    }
  });

  it('is asked of a summary with no function of its own and no notify function to fall back on', () => {
    const [issue, ...rest] = issuesOfGoal(without(oneOff, ['notify', 'summary', 'through']));

    expectAsked('channel', issue, '/0/notify/summary/through');
    expect(rest).toEqual([]);
  });
});

describe('the question of how often the summary should come', () => {
  it('is asked when a change is told in a summary and none is scheduled', () => {
    const [issue, ...rest] = issuesOfGoal(without(oneOff, ['notify', 'summary']));

    expectAsked('rhythm', issue, '/0/notify/summary');
    expect(rest).toEqual([]);
  });

  it('is asked of a summary that names no schedule', () => {
    const [issue, ...rest] = issuesOfGoal(without(oneOff, ['notify', 'summary', 'cron']));

    expectAsked('rhythm', issue, '/0/notify/summary/cron');
    expect(rest).toEqual([]);
  });
});
