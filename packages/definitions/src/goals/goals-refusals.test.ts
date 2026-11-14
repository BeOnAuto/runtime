import { internalTermsIn } from '@on.auto/operations/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { changed, controls, experimentMilestones, experiments, oneOff, textOf, without } from './goal-examples.ts';
import type { GoalIssue } from './goal-issues.ts';
import { goalsDocumentOf } from './goals-check.ts';

function issuesOfGoal(goal: unknown): readonly GoalIssue[] {
  const issues = Result.match(goalsDocumentOf(textOf([goal])), { onSuccess: () => [], onFailure: (found) => found });
  for (const { detail } of issues) {
    expect(new TextEncoder().encode(detail).length).toBeLessThanOrEqual(256);
    expect(internalTermsIn(detail)).toEqual([]);
  }
  return issues;
}

const firstFour = experimentMilestones.slice(0, 4);

function withLastMilestone(milestone: unknown): unknown {
  return { ...experiments, milestones: [...firstFour, milestone] };
}

const ofTheGoal: readonly (readonly [string, unknown, string])[] = [
  ['a goal that is not a set of keys', 'paying-customers', '/0'],
  ['an unknown key on a goal', changed(experiments, ['owner', 'name'], 'me'), '/0/owner'],
  ['an unknown key with a slash and a tilde', { ...experiments, 'a/b~c': 1 }, '/0/a~1b~0c'],
  ['a long unknown key', { ...experiments, ['k'.repeat(300)]: 1 }, `/0/${'k'.repeat(300)}`],
  ['no id', without(experiments, ['id']), '/0/id'],
  ['an id out of its pattern', { ...experiments, id: 'Paying Customers' }, '/0/id'],
  ['an id that is a number', { ...experiments, id: 7 }, '/0/id'],
  ['a statement too short', { ...experiments, statement: 'Customers' }, '/0/statement'],
  ['a statement too long', { ...experiments, statement: 'a'.repeat(201) }, '/0/statement'],
  ['a statement that is not text', { ...experiments, statement: null }, '/0/statement'],
  ['a per too short', { ...experiments, per: 'x' }, '/0/per'],
  ['a name too short', { ...experiments, name: 'C' }, '/0/name'],
  ['a name too long', { ...experiments, name: 'a'.repeat(41) }, '/0/name'],
  ['a name that is not text', { ...experiments, name: ['Paying', 'customers'] }, '/0/name'],
  ['a name on two lines', { ...experiments, name: 'Paying\ncustomers' }, '/0/name'],
  ['a name with a tab', { ...experiments, name: 'Paying\tcustomers' }, '/0/name'],
  ['a name with a character that is not shown', { ...experiments, name: 'Paying\u200Bcustomers' }, '/0/name'],
  ['a retired that is not true or false', { ...experiments, retired: 'yes' }, '/0/retired'],
];

const ofTheMilestones: readonly (readonly [string, unknown, string])[] = [
  ['two milestones', { ...experiments, milestones: firstFour.slice(0, 2) }, '/0/milestones'],
  [
    'eight milestones',
    {
      ...experiments,
      milestones: [
        ...experimentMilestones,
        { id: 'sixth', label: 'Sixth', by: 'auto' },
        { id: 'seventh', label: 'Seventh', by: 'auto' },
        { id: 'eighth', label: 'Eighth', by: 'auto' },
      ],
    },
    '/0/milestones',
  ],
  ['milestones that are not a list', { ...experiments, milestones: 'chosen' }, '/0/milestones'],
  ['a milestone that is not a set of keys', withLastMilestone('concluded'), '/0/milestones/4'],
  ['a milestone named twice', withLastMilestone(experimentMilestones[0]), '/0/milestones/4/id'],
  ['a milestone with no id', withLastMilestone({ label: 'Lesson kept', by: 'person' }), '/0/milestones/4/id'],
  ['a milestone with no label', withLastMilestone({ id: 'concluded', by: 'person' }), '/0/milestones/4/label'],
  [
    'a milestone that does not say who marks it',
    withLastMilestone({ id: 'concluded', label: 'Kept' }),
    '/0/milestones/4/by',
  ],
  [
    'a milestone marked by someone unknown',
    withLastMilestone({ id: 'concluded', label: 'Kept', by: 'robot' }),
    '/0/milestones/4/by',
  ],
  [
    'an unknown key on a milestone',
    withLastMilestone({ id: 'concluded', label: 'Kept', by: 'person', at: 1 }),
    '/0/milestones/4/at',
  ],
];

const ofTheWindow: readonly (readonly [string, unknown, string])[] = [
  ['a window that is not a set of keys', { ...experiments, window: 'P7D' }, '/0/window'],
  ['a window with an unknown key', changed(experiments, ['window', 'until'], 'P9D'), '/0/window/until'],
  ['a window with after and calendar', changed(controls, ['window', 'after'], 'live'), '/0/window'],
  ['a window with neither after nor calendar', { ...controls, window: { grace: 'PT1H' } }, '/0/window'],
  ['after naming no milestone of the goal', changed(experiments, ['window', 'after'], 'launched'), '/0/window/after'],
  ['after that is not a milestone id', changed(experiments, ['window', 'after'], 'Taken live'), '/0/window/after'],
  ['after with no for', without(experiments, ['window', 'for']), '/0/window/for'],
  ['for with calendar', changed(controls, ['window', 'for'], 'P1D'), '/0/window/for'],
  ['a time zone with after', changed(experiments, ['window', 'time_zone'], 'UTC'), '/0/window/time_zone'],
  ['a calendar unit that is not one', changed(controls, ['window', 'calendar'], 'year'), '/0/window/calendar'],
  ['a time zone that is not text', changed(controls, ['window', 'time_zone'], 5), '/0/window/time_zone'],
  ['a grace that is not text', changed(controls, ['window', 'grace'], 1), '/0/window/grace'],
  ['calendar with per', { ...controls, per: 'control' }, '/0/per'],
  ['days with after', changed(experiments, ['window', 'days'], ['monday']), '/0/window/days'],
  ['days on a weekly window', { ...controls, window: { calendar: 'week', days: ['monday'] } }, '/0/window/days'],
  ['days that are not a list', changed(controls, ['window', 'days'], 'monday'), '/0/window/days'],
  ['an empty list of days', changed(controls, ['window', 'days'], []), '/0/window/days'],
  ['a day that is not one', changed(controls, ['window', 'days'], ['monday', 'Funday']), '/0/window/days/1'],
  ['a day named twice', changed(controls, ['window', 'days'], ['monday', 'friday', 'monday']), '/0/window/days/2'],
  ['at_close without a window', changed(oneOff, ['success', 'settles'], 'at_close'), '/0/success/settles'],
];

const ofTheSuccess: readonly (readonly [string, unknown, string])[] = [
  ['success that is not a set of keys', { ...experiments, success: 'one customer' }, '/0/success'],
  ['an unknown key in success', changed(experiments, ['success', 'unit'], 'customers'), '/0/success/unit'],
  ['no settles', without(experiments, ['success', 'settles']), '/0/success/settles'],
  ['a settles that is not one', changed(experiments, ['success', 'settles'], 'eventually'), '/0/success/settles'],
  ['verdict words too long', changed(experiments, ['success', 'passed'], 'p'.repeat(41)), '/0/success/passed'],
  ['a target that is not a set of keys', changed(experiments, ['success', 'target'], 1), '/0/success/target'],
  ['a target with both bounds', changed(experiments, ['success', 'target', 'at_most'], 3), '/0/success/target'],
  ['a target with neither bound', changed(experiments, ['success', 'target'], {}), '/0/success/target'],
  [
    'a target with an unknown key',
    changed(experiments, ['success', 'target', 'exactly'], 3),
    '/0/success/target/exactly',
  ],
  [
    'a target that is not a number',
    changed(experiments, ['success', 'target', 'at_least'], 'one'),
    '/0/success/target/at_least',
  ],
  [
    'a target that is not finite',
    changed(experiments, ['success', 'target', 'at_least'], Infinity),
    '/0/success/target/at_least',
  ],
];

const ofTheNotify: readonly (readonly [string, unknown, string])[] = [
  ['notify that is not a set of keys', { ...experiments, notify: 'now' }, '/0/notify'],
  ['an unknown key in notify', changed(experiments, ['notify', 'retried'], 'now'), '/0/notify/retried'],
  ['a way to hear that is not one', changed(experiments, ['notify', 'passed'], 'loudly'), '/0/notify/passed'],
  [
    'a function name out of its pattern',
    changed(experiments, ['notify', 'through'], 'Tell Owner'),
    '/0/notify/through',
  ],
  ['a summary that is not a set of keys', changed(experiments, ['notify', 'summary'], 'weekly'), '/0/notify/summary'],
  [
    'an unknown key in a summary',
    changed(experiments, ['notify', 'summary', 'every'], 'P1W'),
    '/0/notify/summary/every',
  ],
  [
    'a summary schedule that is not text',
    changed(experiments, ['notify', 'summary', 'cron'], 5),
    '/0/notify/summary/cron',
  ],
  [
    'a summary time zone that is not text',
    changed(experiments, ['notify', 'summary', 'time_zone'], true),
    '/0/notify/summary/time_zone',
  ],
  [
    'a summary function out of its pattern',
    changed(experiments, ['notify', 'summary', 'through'], 'W'),
    '/0/notify/summary/through',
  ],
];

function agentsAt(goal: unknown, pointer: string): readonly string[] {
  return issuesOfGoal(goal)
    .filter((issue) => issue.pointer === pointer)
    .map((issue) => issue.fixed_by);
}

describe("the problems of a goal that are the agent's to fix", () => {
  it.each(ofTheGoal)('refuse %s, at its place', (_, goal, pointer) => {
    expect(new Set(agentsAt(goal, pointer))).toEqual(new Set(['agent']));
  });
  it('say what a name may hold', () => {
    expect([
      issuesOfGoal({ ...experiments, name: 'C' }),
      issuesOfGoal({ ...experiments, name: 'Paying\ncustomers' }),
    ]).toEqual([
      [
        {
          pointer: '/0/name',
          detail: 'The name of the goal paying-customers is text of 2 to 40 characters',
          fixed_by: 'agent',
        },
      ],
      [
        {
          pointer: '/0/name',
          detail:
            'The name of the goal paying-customers is plain text on one line, with no tab and no character that is not shown',
          fixed_by: 'agent',
        },
      ],
    ]);
  });
});

describe("the problems of the milestones that are the agent's to fix", () => {
  it.each(ofTheMilestones)('refuse %s, at its place', (_, goal, pointer) => {
    expect(new Set(agentsAt(goal, pointer))).toEqual(new Set(['agent']));
  });
});

describe('the words of a milestone count refused', () => {
  it.each([
    [1, 'The goal paying-customers names 1 milestone; name none, or three to seven'],
    [2, 'The goal paying-customers names 2 milestones; name none, or three to seven'],
  ])('count %i milestones in the right number', (count, detail) => {
    const issues = issuesOfGoal({ ...experiments, milestones: firstFour.slice(0, count) });
    expect(issues.filter(({ pointer }) => pointer === '/0/milestones').map((issue) => issue.detail)).toEqual([detail]);
  });
});

describe("the problems of the window that are the agent's to fix", () => {
  it.each(ofTheWindow)('refuse %s, at its place', (_, goal, pointer) => {
    expect(new Set(agentsAt(goal, pointer))).toEqual(new Set(['agent']));
  });
});

describe('the words of days refused', () => {
  it('say which days a daily window takes, and that only a daily window takes them', () => {
    expect([
      issuesOfGoal(changed(controls, ['window', 'days'], ['mon'])),
      issuesOfGoal(changed(controls, ['window', 'days'], [])),
      issuesOfGoal(changed(controls, ['window', 'days'], ['monday', 'monday'])),
      issuesOfGoal({ ...controls, window: { calendar: 'month', days: ['monday'] } }),
    ]).toEqual([
      [
        {
          pointer: '/0/window/days/0',
          detail:
            'Day 1 of the goal controls-hold is one of monday, tuesday, wednesday, thursday, friday, saturday, sunday',
          fixed_by: 'agent',
        },
      ],
      [
        {
          pointer: '/0/window/days',
          detail: 'The days of the goal controls-hold name at least one day; leave days out to judge every day',
          fixed_by: 'agent',
        },
      ],
      [
        {
          pointer: '/0/window/days/1',
          detail: 'The days of the goal controls-hold name monday more than once',
          fixed_by: 'agent',
        },
      ],
      [
        {
          pointer: '/0/window/days',
          detail: 'The window of the goal controls-hold takes days only with calendar: day',
          fixed_by: 'agent',
        },
      ],
    ]);
  });
});

describe("the problems of success that are the agent's to fix", () => {
  it.each(ofTheSuccess)('refuse %s, at its place', (_, goal, pointer) => {
    expect(new Set(agentsAt(goal, pointer))).toEqual(new Set(['agent']));
  });
});

describe("the problems of notify that are the agent's to fix", () => {
  it.each(ofTheNotify)('refuse %s, at its place', (_, goal, pointer) => {
    expect(new Set(agentsAt(goal, pointer))).toEqual(new Set(['agent']));
  });
});
