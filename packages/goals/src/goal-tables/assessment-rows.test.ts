import type { ProjectedMessage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { assessmentRows } from './assessment-rows.ts';
import { rowFoldedOf } from './folded-rows.ts';

const at = (text: string) => Date.parse(text);

const window = {
  opens: '2026-11-02T17:00:00.000Z',
  closes: '2026-11-09T17:00:00.000Z',
  due: '2026-11-10T17:00:00.000Z',
};

const source = {
  record: '0b9f1c2e-5d4a-4f7e-9a61-3c2d8e7f1a05',
  run: '6a1e2b3c-4d5e-4f60-8a71-92b3c4d5e6f7',
  workflow: 'measure-experiments',
  version: 3,
  entry: 0,
};

const opened = {
  type: 'goal_assessment_opened',
  data: {
    goal: 'paying-customers',
    goals_version: 2,
    per: { id: 'experiment-7' },
    window,
    rule: { settles: 'at_close', target: { at_least: 1 }, window: { calendar: 'week' } },
    milestones: [
      { id: 'chosen', label: 'Idea chosen', by: 'person' },
      { id: 'live', label: 'Taken live', by: 'person' },
      { id: 'measured', label: 'Measured', by: 'auto' },
    ],
  },
};

const marked = (milestone: string, record: string) => ({
  type: 'goal_observed',
  data: { source: { ...source, record }, at: '2026-11-03T10:00:00.000Z', marks: milestone, title: 'Webinar' },
});

const overdue = { type: 'goal_overdue', data: { since: window.due, told: 'now' } };

const started = { type: 'goal_notice_started', data: { change: 'overdue', run: 'notice-run' } };

const refused = {
  type: 'goal_notice_refused',
  data: { change: 'overdue', attempt: 1, detail: 'unavailable', retry_at: '2026-11-10T17:05:00.000Z' },
};

const assessed = {
  type: 'goal_assessed',
  data: { verdict: 'passed', at: '2026-11-11T09:00:00.000Z', by: 'final', told: 'summary' },
};

const ended = { type: 'goal_assessment_ended', data: { reason: 'no_result' } };

interface Fact {
  readonly type: string;
  readonly data: unknown;
}

const messageOf = ({ type, data }: Fact, position: number, moment: string): ProjectedMessage => ({
  id: `fact-${String(position)}`,
  position,
  type,
  data,
  context: { at: moment, by: 'playbook:alpha' },
});

const foldedOf = (facts: readonly Fact[], moment = '2026-11-09T18:00:00.000Z') =>
  rowFoldedOf(
    assessmentRows,
    facts.map((fact, position) => messageOf(fact, position, moment)),
  );

describe('the row of an assessment', () => {
  it('is kept from its opening, with its goal, its thing, its window and the milestones it pins', () => {
    expect(foldedOf([opened])).toMatchObject({
      goal: 'paying-customers',
      goals_version: 2,
      per_id: 'experiment-7',
      window_opens: at(window.opens),
      window_closes: at(window.closes),
      window_due: at(window.due),
      next_milestone: 'chosen',
      mark_1: null,
      verdict: 'open',
      open: true,
      overdue: false,
      outcome: null,
      opened_at: at('2026-11-09T18:00:00.000Z'),
      observed_at: null,
      judging_due_at: at(window.due),
      no_result_at: at('2026-11-16T01:00:00.000Z'),
      notice_due_at: null,
      notices: '[]',
    });
  });

  it('is no row for a fact before the opening, nor for a message no goal fact reads', () => {
    expect(foldedOf([marked('chosen', 'record-1')])).toBeUndefined();
    expect(assessmentRows.rowAfter(undefined, messageOf({ type: 'goal_observed', data: {} }, 0, 'now'))).toBe(
      undefined,
    );
  });

  it('marks the milestone at its place in the list, and names the next one still to come', () => {
    expect(foldedOf([opened, marked('live', 'record-1'), marked('chosen', 'record-2')])).toMatchObject({
      mark_1: 'chosen',
      mark_2: 'live',
      mark_3: null,
      next_milestone: 'measured',
      title: 'Webinar',
      observed_at: at('2026-11-03T10:00:00.000Z'),
    });
  });
});

describe('the row of an assessment past its due', () => {
  it('goes overdue as it was told, owes its notice at once, and is judged next at its no-result end', () => {
    expect(foldedOf([opened, overdue])).toMatchObject({
      overdue: true,
      overdue_since: at(window.due),
      overdue_told: 'now',
      judging_due_at: at('2026-11-16T01:00:00.000Z'),
      notice_due_at: at(window.due),
    });
  });

  it('owes its notice again at the retry a refusal names, and no more once the notice is seen started', () => {
    expect(foldedOf([opened, overdue, refused])).toMatchObject({ notice_due_at: at('2026-11-10T17:05:00.000Z') });
    expect(foldedOf([opened, overdue, refused, started, started], '2026-11-10T17:06:00.000Z')).toMatchObject({
      notice_due_at: null,
      notices: JSON.stringify([{ change: 'overdue', at: '2026-11-10T17:06:00.000Z', run: 'notice-run' }]),
    });
  });
});

describe('the notices of an assessment', () => {
  it('keeps each refused start of a notice until that notice is seen started, and when the latest one began', () => {
    const failedRefused = {
      type: 'goal_notice_refused',
      data: { change: 'failed', attempt: 6, detail: 'The function tell-owner is paused' },
    };

    expect(foldedOf([opened, overdue, refused, failedRefused])).toMatchObject({
      noticed_at: null,
      notice_refused_at: at('2026-11-09T18:00:00.000Z'),
      notice_refusals: JSON.stringify([
        {
          change: 'overdue',
          attempt: 1,
          detail: 'unavailable',
          at: '2026-11-09T18:00:00.000Z',
          retry_at: '2026-11-10T17:05:00.000Z',
        },
        { change: 'failed', attempt: 6, detail: 'The function tell-owner is paused', at: '2026-11-09T18:00:00.000Z' },
      ]),
    });
    expect(foldedOf([opened, overdue, refused, started], '2026-11-10T17:06:00.000Z')).toMatchObject({
      noticed_at: at('2026-11-10T17:06:00.000Z'),
      notice_refused_at: null,
      notice_refusals: '[]',
    });
  });

  it('lets the clock move its judging and its notice past the present, until a fact that changes them', () => {
    expect(assessmentRows.advanced).toEqual([
      {
        column: 'judging_due_at',
        setBy: ['goal_assessment_opened', 'goal_observed', 'goal_assessed', 'goal_overdue', 'goal_assessment_ended'],
      },
      {
        column: 'notice_due_at',
        setBy: ['goal_assessed', 'goal_overdue', 'goal_notice_started', 'goal_notice_refused'],
      },
    ]);
  });
});

describe('the row of an assessment closed', () => {
  it('is closed by its verdict, with how it was told, and is judged no more', () => {
    const failedLater = { type: 'goal_assessed', data: { ...assessed.data, verdict: 'failed', told: 'now' } };
    const overdueLater = { type: 'goal_overdue', data: { since: '2026-11-12T00:00:00.000Z', told: 'quiet' } };

    expect(foldedOf([opened, overdue, overdueLater, assessed, failedLater])).toMatchObject({
      verdict: 'passed',
      verdict_at: at(assessed.data.at),
      verdict_told: 'summary',
      overdue_told: 'now',
      outcome: 'passed',
      open: false,
      closed_at: at(assessed.data.at),
      judging_due_at: null,
      no_result_at: null,
    });
  });

  it('is closed by its ending at the moment it ended, with the reason as its outcome', () => {
    expect(foldedOf([opened, overdue, ended], '2026-11-17T17:00:00.000Z')).toMatchObject({
      outcome: 'no_result',
      open: false,
      closed_at: at('2026-11-17T17:00:00.000Z'),
      judging_due_at: null,
    });
  });

  it('takes a row whose state it cannot read for one never opened', () => {
    expect(assessmentRows.rowAfter({ state: 'unreadable' }, messageOf(overdue, 1, 'now'))).toBeUndefined();
  });
});
