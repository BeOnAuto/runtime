import { describe, expect, it } from 'vitest';

import type { GoalRule } from '../goal-rules/goal-rule.ts';
import { judgingDueOf, nextMilestoneOf, noticeDueOf } from './assessment-dues.ts';
import type { AssessmentFact } from './assessment-facts.ts';
import { assessmentAfter, assessmentOf, unopened, type AssessmentState } from './assessment-state.ts';
import { factsAtMoment } from './judging.ts';
import { openedData, openedFact } from './opening.ts';

const hour = (offset: number) => Date.UTC(2026, 10, 9, offset);

const iso = (at: number) => new Date(at).toISOString();

const daily: GoalRule = {
  id: 'daily-check',
  window: { calendar: 'day' },
  success: { settles: 'at_close', target: { at_most: 0 } },
  milestones: [{ id: 'checked', label: 'Checked', by: 'auto' }],
  notify: { passed: 'now', failed: 'now', overdue: 'now' },
};

const span = { opens: hour(0), closes: hour(24), due: hour(25) };

const opened = openedFact(openedData(daily, 1, { window: span }));

const monday = assessmentOf([opened]);

const after = (state: AssessmentState, ...facts: readonly AssessmentFact[]) =>
  facts.reduce((before, fact) => assessmentAfter(before, fact), state);

const overdue: AssessmentFact = { type: 'goal_overdue', data: { since: iso(hour(25)), told: 'now' } };

const failed: AssessmentFact = {
  type: 'goal_assessed',
  data: { verdict: 'failed', at: iso(hour(30)), by: 'final', told: 'now' },
};

const ended: AssessmentFact = { type: 'goal_assessment_ended', data: { reason: 'no_result' } };

const marked: AssessmentFact = {
  type: 'goal_observed',
  data: {
    source: { record: 'r', run: 'run', workflow: 'w', version: 1, entry: 0 },
    at: iso(hour(1)),
    marks: 'checked',
  },
};

describe('what is due next for an assessment', () => {
  it('is its due while it is open, then its no-result end while it is overdue, then nothing', () => {
    expect([
      judgingDueOf(monday),
      judgingDueOf(after(monday, overdue)),
      judgingDueOf(after(monday, overdue, ended)),
    ]).toEqual([hour(25), hour(49), undefined]);
    expect([judgingDueOf(unopened), judgingDueOf(after(monday, failed))]).toEqual([undefined, undefined]);
  });

  it('is the soonest notice owed', () => {
    expect([noticeDueOf(monday), noticeDueOf(after(monday, overdue, failed))]).toEqual([undefined, hour(25)]);
    expect(
      noticeDueOf(after(monday, failed, { type: 'goal_overdue', data: { since: iso(hour(31)), told: 'now' } })),
    ).toBe(hour(30));
  });

  it('names the first milestone not yet marked', () => {
    expect([nextMilestoneOf(unopened), nextMilestoneOf(monday), nextMilestoneOf(after(monday, marked))]).toEqual([
      undefined,
      'checked',
      undefined,
    ]);
  });
});

describe('the fold of an assessment', () => {
  it('ignores what comes before its opening', () => {
    expect(after(unopened, marked, failed, overdue, ended)).toEqual(unopened);
  });

  it('keeps its first opening, verdict, overdue and ending', () => {
    const second = openedFact(
      openedData({ ...daily, success: { settles: 'at_close', target: { at_most: 9 } } }, 2, { window: span }),
    );
    const passed: AssessmentFact = {
      type: 'goal_assessed',
      data: { verdict: 'passed', at: iso(hour(31)), by: 'final', told: 'now' },
    };
    const settled = after(monday, second, overdue, overdue, failed, passed, ended, {
      type: 'goal_assessment_ended',
      data: { reason: 'goal_retired' },
    });

    expect([settled.pinned?.target, settled.verdict, settled.overdueSince, settled.ended]).toEqual([
      { at_most: 0 },
      'failed',
      hour(25),
      'no_result',
    ]);
    expect(after(settled, marked).marks).toEqual([]);
  });

  it('owes nothing for a change told in a summary or not at all', () => {
    expect(after(monday, { type: 'goal_overdue', data: { since: iso(hour(25)), told: 'summary' } }).owed).toEqual([]);
  });
});

describe('the clock on an assessment', () => {
  it('does nothing before the due, for a settled one, or for one with no window', () => {
    const { window: _, ...whole } = daily;
    const noWindow = assessmentOf([openedFact(openedData(whole, 1, {}))]);
    const at = (state: AssessmentState, now: number) =>
      factsAtMoment(state, { goal: daily, now, playbookRetired: false });

    expect([
      at(monday, hour(24)),
      at(after(monday, failed), hour(60)),
      at(noWindow, hour(60)),
      at(unopened, hour(60)),
    ]).toEqual([[], [], [], []]);
  });

  it('waits on an overdue one until its no-result end', () => {
    expect(factsAtMoment(after(monday, overdue), { goal: daily, now: hour(48), playbookRetired: false })).toEqual([]);
  });
});
