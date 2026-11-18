import type { ProjectedMessage } from '@on.auto/operations';
import { streamAddressed } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { summaryRunIdOf } from '../assessments/assessment-identity.ts';
import { clockKey, clockRows, goalClocksIn, nextSummaryOf } from './clock-rows.ts';
import { rowFoldedOf } from './folded-rows.ts';

const at = (text: string) => Date.parse(text);

const daily = {
  id: 'controls-hold',
  statement: 'Keep every control holding each day.',
  window: { calendar: 'day' },
  success: {
    label: 'Failed controls',
    settles: 'on_crossing',
    target: { at_most: 0 },
    passed: 'Held',
    failed: 'Broke',
  },
  notify: {
    passed: 'quiet',
    failed: 'now',
    overdue: 'now',
    through: 'tell-owner',
    summary: { cron: '0 9 1 * *', time_zone: 'UTC' },
  },
};

const { summary: _summary, ...unsummarised } = daily.notify;

const weekly = {
  id: 'paying-customers',
  statement: 'Bring in paying customers every week.',
  success: { label: 'Customers', settles: 'on_crossing', target: { at_least: 1 }, passed: 'Won', failed: 'Lost' },
  notify: {
    passed: 'summary',
    failed: 'summary',
    summary: { cron: '0 9 * * 5', through: 'weekly-note' },
  },
};

const saved = (goals: readonly unknown[], version: number) => ({
  type: 'playbook_goals_saved',
  data: { source: 'goals', goals, version },
});

const opened = (goal: string, opens: string) => ({
  type: 'goal_assessment_opened',
  data: {
    goal,
    goals_version: 1,
    window: { opens, closes: opens, due: opens },
    rule: { settles: 'on_crossing', target: { at_most: 0 }, window: { calendar: 'day' } },
    milestones: [],
  },
});

const summarised = (due: string, run: string) => ({
  type: 'goal_summary_started',
  data: { due, window: { from: due, to: due }, run },
});

interface Fact {
  readonly type: string;
  readonly data: unknown;
  readonly moment?: string;
}

const messageOf = ({ type, data, moment = '2026-11-09T12:00:00.000Z' }: Fact, position: number): ProjectedMessage => ({
  id: `fact-${String(position)}`,
  position,
  type,
  data,
  context: { at: moment, by: 'person:ada' },
});

const foldedOf = (facts: readonly Fact[]) =>
  rowFoldedOf(
    clockRows,
    facts.map((fact, position) => messageOf(fact, position)),
  );

const stream = streamAddressed('playbook/acme/alpha/goals/playbook');

describe('the clock row of a playbook', () => {
  it('keeps the windows opened and the summaries fired over a later save, and takes no other fact', () => {
    const due = '2026-11-13T09:00:00.000Z';
    const before = foldedOf([
      saved([daily, weekly], 1),
      opened('controls-hold', '2026-11-10T00:00:00.000Z'),
      summarised(due, summaryRunIdOf('paying-customers', at(due))),
    ]);
    const { data } = opened('paying-customers', due);
    const { window: _window, ...unwindowed } = data;

    expect(
      foldedOf([
        saved([daily, weekly], 1),
        opened('controls-hold', '2026-11-10T00:00:00.000Z'),
        summarised(due, summaryRunIdOf('paying-customers', at(due))),
        { type: 'goal_assessment_opened', data: unwindowed },
        { type: 'goal_summary_started', data: { due } },
        saved([daily, weekly], 2),
      ]),
    ).toEqual({ ...before, goals_version: 2 });
  });

  it('writes nothing for a fact that moves no goal’s clock, so a due its reader advanced stands', () => {
    const row = foldedOf([saved([daily, weekly], 1)]);
    const { data } = opened('paying-customers', '2026-11-13T09:00:00.000Z');
    const { window: _window, ...unwindowed } = data;

    expect(
      [
        { type: 'goal_assessment_opened', data: unwindowed },
        opened('paying-customers', '2026-11-13T09:00:00.000Z'),
        summarised('2026-11-20T09:00:00.000Z', 'another-run'),
      ].map((fact: Fact, position) => clockRows.rowAfter(row, messageOf(fact, position))),
    ).toEqual([undefined, undefined, undefined]);
    expect(clockRows.advanced).toEqual([
      { column: 'opens_at', setBy: ['playbook_goals_saved', 'goal_assessment_opened'] },
      { column: 'summary_at', setBy: ['playbook_goals_saved', 'goal_summary_started'] },
    ]);
  });

  it('is one row a playbook, for the facts it folds alone', () => {
    expect(
      ['playbook_goals_saved', 'goal_assessment_opened', 'goal_summary_started', 'goal_overdue'].map((type) =>
        clockRows.keyOf?.(messageOf({ type, data: {} }, 0), stream),
      ),
    ).toEqual([clockKey, clockKey, clockKey, undefined]);
  });
});

describe('the clock row of the goals a playbook saved', () => {
  it('is kept from the first save of the goals, due at the next window to open and the next summary', () => {
    const row = foldedOf([saved([daily, weekly], 1)]);

    expect(row).toMatchObject({
      goals_version: 1,
      opens_at: at('2026-11-10T00:00:00.000Z'),
      summary_at: at('2026-11-13T09:00:00.000Z'),
    });
    expect(goalClocksIn(row).map(({ id, first_saved_at }) => [id, first_saved_at])).toEqual([
      ['controls-hold', at('2026-11-09T12:00:00.000Z')],
      ['paying-customers', at('2026-11-09T12:00:00.000Z')],
    ]);
  });

  it('opens a window that starts at the very moment of the first save', () => {
    expect(
      foldedOf([{ ...saved([{ ...daily, notify: unsummarised }], 1), moment: '2026-11-10T00:00:00.000Z' }]),
    ).toMatchObject({
      opens_at: at('2026-11-10T00:00:00.000Z'),
      summary_at: null,
    });
  });

  it('is no row before the goals are saved', () => {
    expect(foldedOf([opened('controls-hold', '2026-11-10T00:00:00.000Z')])).toBeUndefined();
  });
});

describe('the clock row of goals that ran', () => {
  it('moves the next window past the windows already opened, and the next summary past the summaries that fired', () => {
    const due = '2026-11-13T09:00:00.000Z';

    expect(
      foldedOf([
        saved([daily, weekly], 1),
        opened('controls-hold', '2026-11-10T00:00:00.000Z'),
        opened('controls-hold', '2026-11-09T00:00:00.000Z'),
        opened('paying-customers', '2026-11-12T00:00:00.000Z'),
        summarised(due, summaryRunIdOf('paying-customers', at(due))),
        summarised('2026-11-20T09:00:00.000Z', 'another-run'),
      ]),
    ).toMatchObject({
      goals_version: 1,
      opens_at: at('2026-11-11T00:00:00.000Z'),
      summary_at: at('2026-11-20T09:00:00.000Z'),
    });
  });

  it('keeps each goal’s first save over later saves, forgets a goal left out, and is due at once to end what a retired goal left open', () => {
    const row = foldedOf([
      saved([daily, weekly], 1),
      { ...saved([{ ...daily, retired: true }], 2), moment: '2026-11-12T00:00:00.000Z' },
    ]);

    expect(row).toMatchObject({ goals_version: 2, opens_at: at('2026-11-12T00:00:00.000Z'), summary_at: null });
    expect(goalClocksIn(row).map(({ id, first_saved_at, retired }) => [id, first_saved_at, retired])).toEqual([
      ['controls-hold', at('2026-11-09T12:00:00.000Z'), true],
    ]);
  });

  it('reads no goals from a row it cannot read, and no summary from a schedule that does not come round', () => {
    expect(goalClocksIn({ goals: 'unreadable' })).toEqual([]);
    expect(
      nextSummaryOf({
        id: 'paying-customers',
        first_saved_at: 0,
        summary: { cron: '0 9 * * 5', time_zone: 'Europe/Berlin' },
      }),
    ).toBe(Date.parse('1970-01-02T08:00:00.000Z'));
    expect(nextSummaryOf({ id: 'paying-customers', first_saved_at: 0, summary: { cron: 'never' } })).toBeNull();
  });
});

describe('the clock row of a goal retired before its clock ran', () => {
  it('keeps a due its clock has not worked yet when another goal’s window opens, and drops the one an opening meets', () => {
    const retiring = foldedOf([
      saved([daily, weekly], 1),
      { ...saved([daily, { ...weekly, retired: true }], 2), moment: '2026-11-09T18:00:00.000Z' },
      opened('controls-hold', '2026-11-09T00:00:00.000Z'),
    ]);
    const unarmed = clockRows.rowAfter(
      { ...foldedOf([saved([daily, weekly], 1)]), opens_at: null },
      messageOf(opened('controls-hold', '2026-11-10T00:00:00.000Z'), 1),
    );

    expect(retiring).toMatchObject({ goals_version: 2, opens_at: at('2026-11-09T18:00:00.000Z') });
    expect(unarmed).toMatchObject({ opens_at: at('2026-11-11T00:00:00.000Z') });
  });
});

const workflowFact = (type: string, moment: string): ProjectedMessage => ({
  id: `definition-${type}`,
  position: 0,
  type,
  data: {},
  context: { at: moment, by: 'person:ada', definitionType: 'workflow', definitionName: 'check', definitionVersion: 1 },
});

describe('the clock row of a playbook whose workflows are saved or resumed', () => {
  it('takes no fact of a workflow, which lies under the workflow’s own key: the clock reads when one was last saved as it works', () => {
    const quiet = { ...foldedOf([saved([daily, weekly], 1)]), opens_at: null };
    const facts = ['definition_created', 'definition_updated', 'definition_resumed', 'definition_restored'];

    expect(facts.map((type) => clockRows.rowAfter(quiet, workflowFact(type, '2026-11-10T10:00:00.000Z')))).toEqual(
      Array.from({ length: facts.length }),
    );
    expect(
      clockRows.keyOf?.(
        workflowFact('definition_resumed', '2026-11-10T10:00:00.000Z'),
        streamAddressed('definition/acme/d1/definitions/workflow'),
      ),
    ).toBeUndefined();
    expect([clockRows.kinds, facts.filter((type) => clockRows.types.includes(type))]).toEqual([
      ['goals', 'assessments', 'goal-summaries'],
      [],
    ]);
  });
});
