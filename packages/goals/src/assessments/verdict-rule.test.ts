import { describe, expect, it } from 'vitest';

import type { GoalRule } from '../goal-rules/goal-rule.ts';
import { toldOf } from './verdict-rule.ts';

const rule: GoalRule = {
  id: 'controls-hold',
  window: { calendar: 'day' },
  success: { settles: 'on_crossing', target: { at_most: 0 } },
  notify: { passed: 'quiet', failed: 'now', overdue: 'summary' },
};

const { notify: _told, ...untold } = rule;

describe('what the person is told of a change', () => {
  it('is what the goal asks for each change, and quiet for overdue where it asks nothing of it', () => {
    expect([toldOf(rule, 'passed'), toldOf(rule, 'failed'), toldOf(rule, 'overdue')]).toEqual([
      'quiet',
      'now',
      'summary',
    ]);
    expect(toldOf({ ...rule, notify: { passed: 'now', failed: 'now' } }, 'overdue')).toBe('quiet');
  });

  it('is quiet for every change of a goal that leaves notify out, so nothing is owed', () => {
    expect([toldOf(untold, 'passed'), toldOf(untold, 'failed'), toldOf(untold, 'overdue')]).toEqual([
      'quiet',
      'quiet',
      'quiet',
    ]);
  });
});
