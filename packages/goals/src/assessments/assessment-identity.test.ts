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
} from './assessment-identity.ts';

const source = { record: 'r', run: 'run', workflow: 'w', version: 1, entry: 0 };

const daily: GoalRule = {
  id: 'daily-check',
  window: { calendar: 'day' },
  success: { settles: 'at_close', target: { at_most: 0 } },
  notify: { passed: 'now', failed: 'now', overdue: 'now' },
};

describe('the identity of an assessment', () => {
  it('names the goal, the goal and thing, or the goal and the start of its window', () => {
    expect([
      assessmentNameOf({ goal: 'g-one' }),
      assessmentNameOf({ goal: 'g-one', per: 'MAR/41' }),
      assessmentNameOf({ goal: 'g-one', window_start: Date.UTC(2026, 10, 9) }),
    ]).toEqual(['goals/g-one', 'goals/g-one/per/MAR/41', 'goals/g-one/window/2026-11-09T00:00:00.000Z']);
  });

  it('is a UUIDv5 of that name under one fixed namespace, the same on every host', () => {
    expect(assessmentIdOf({ goal: 'g-one' })).toBe(uuidV5(assessmentNamespace, 'goals/g-one'));
    expect(assessmentIdOf({ goal: 'g-one', per: 'a' })).not.toBe(assessmentIdOf({ goal: 'g-one', per: 'b' }));
  });

  it('gives a notice the UUIDv5 of its change under the assessment', () => {
    const id = assessmentIdOf({ goal: 'g-one' });

    expect(noticeRunIdOf(id, 'passed')).toBe(uuidV5(id, 'passed'));
    expect(noticeRunIdOf(id, 'passed')).not.toBe(noticeRunIdOf(id, 'overdue'));
  });

  it('puts an observation of a calendar goal in the window that holds its as_of, else the end of its run', () => {
    const at = Date.UTC(2026, 10, 10, 0, 30);

    expect(identityOfObservation(daily, { goal: daily.id, source, at })).toEqual({
      goal: 'daily-check',
      window_start: Date.UTC(2026, 10, 10),
    });
    expect(
      identityOfObservation(daily, {
        goal: daily.id,
        source,
        at,
        measurement: { value: 0, final: true, as_of: Date.UTC(2026, 10, 10) },
      }),
    ).toEqual({ goal: 'daily-check', window_start: Date.UTC(2026, 10, 9) });
  });

  it('puts an observation of another goal under its thing, or under the goal', () => {
    const whole = { ...daily, window: { after: 'live', for: 'P1D' } };

    expect(identityOfObservation(whole, { goal: daily.id, source, at: 0, per: 'A' })).toEqual({
      goal: 'daily-check',
      per: 'A',
    });
    expect(identityOfObservation(whole, { goal: daily.id, source, at: 0 })).toEqual({ goal: 'daily-check' });
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
