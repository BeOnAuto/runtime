import { uuidV5 } from '@on.auto/operations';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { GoalRule } from '../goal-rules/goal-rule.ts';
import { AssessmentFactSchema, goalFactData } from './assessment-facts.ts';
import {
  assessmentIdOf,
  assessmentNameOf,
  assessmentNamespace,
  identityOfObservation,
  noticeRunIdOf,
  summaryRunIdOf,
} from './assessment-identity.ts';

const source = { record: 'r', run: 'run', workflow: 'w', version: 1, entry: 0 };

const daily: GoalRule = {
  id: 'daily-check',
  window: { calendar: 'day' },
  success: { settles: 'at_close', target: { at_most: 0 } },
  notify: { passed: 'now', failed: 'now', overdue: 'now' },
};

describe('the identity of an assessment', () => {
  it('names the identity of the goal, with its thing or with the start of its window', () => {
    expect([
      assessmentNameOf({ definition: 'g-one' }),
      assessmentNameOf({ definition: 'g-one', per: 'MAR/41' }),
      assessmentNameOf({ definition: 'g-one', window_start: Date.UTC(2026, 10, 9) }),
    ]).toEqual(['goals/g-one', 'goals/g-one/per/MAR/41', 'goals/g-one/window/2026-11-09T00:00:00.000Z']);
  });

  it('is a UUIDv5 of that name under one fixed namespace, the same on every host', () => {
    expect(assessmentIdOf({ definition: 'g-one' })).toBe(uuidV5(assessmentNamespace, 'goals/g-one'));
    expect(assessmentIdOf({ definition: 'g-one', per: 'a' })).not.toBe(
      assessmentIdOf({ definition: 'g-one', per: 'b' }),
    );
  });

  it('gives a notice the UUIDv5 of its change under the assessment', () => {
    const id = assessmentIdOf({ definition: 'g-one' });

    expect(noticeRunIdOf(id, 'passed')).toBe(uuidV5(id, 'passed'));
    expect(noticeRunIdOf(id, 'passed')).not.toBe(noticeRunIdOf(id, 'overdue'));
  });

  it('gives a summary the UUIDv5 of the identity of its goal and its time, whatever the goal is named', () => {
    const due = Date.UTC(2026, 10, 13, 9);

    expect(summaryRunIdOf('g-one', due)).toBe(
      uuidV5(assessmentNamespace, 'goals/g-one/summary/2026-11-13T09:00:00.000Z'),
    );
  });
});

describe('the assessment an observation belongs to', () => {
  it('puts an observation of a calendar goal in the window that holds its as_of, else the end of its run', () => {
    const at = Date.UTC(2026, 10, 10, 0, 30);

    expect(identityOfObservation('daily-check-goal', daily, { goal: daily.id, source, at })).toEqual({
      definition: 'daily-check-goal',
      window_start: Date.UTC(2026, 10, 10),
    });
    expect(
      identityOfObservation('daily-check-goal', daily, {
        goal: daily.id,
        source,
        at,
        measurement: { value: 0, final: true, as_of: Date.UTC(2026, 10, 10) },
      }),
    ).toEqual({ definition: 'daily-check-goal', window_start: Date.UTC(2026, 10, 9) });
  });

  it('puts an observation of another goal under its thing, or under the goal', () => {
    const whole = { ...daily, window: { after: 'live', for: 'P1D' } };

    expect(identityOfObservation('daily-check-goal', whole, { goal: daily.id, source, at: 0, per: 'A' })).toEqual({
      definition: 'daily-check-goal',
      per: 'A',
    });
    expect(identityOfObservation('daily-check-goal', whole, { goal: daily.id, source, at: 0 })).toEqual({
      definition: 'daily-check-goal',
    });
  });
});

describe('the facts of an assessment', () => {
  it('names the data of every fact of an assessment', () => {
    expect(Object.keys(goalFactData)).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_assessed',
      'goal_overdue',
      'goal_notice_started',
      'goal_notice_refused',
      'goal_summary_started',
      'goal_assessment_ended',
      'goal_stopped',
      'goal_observation_refused',
      'goal_dismissed',
      'goal_restored',
    ]);
  });

  it('refuses a fact that carries more than its own fields', () => {
    const decoded = Schema.decodeUnknownResult(AssessmentFactSchema)(
      { type: 'goal_overdue', data: { since: '2026-11-09T00:00:00.000Z', told: 'now', output: {} } },
      { onExcessProperty: 'error' },
    );

    expect(Result.isFailure(decoded)).toBe(true);
  });
});
