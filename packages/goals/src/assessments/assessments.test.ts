import { describe, expect, it } from 'vitest';

import type { GoalRule } from '../goal-rules/goal-rule.ts';
import type { Observation } from '../observations/observation.ts';
import { assessmentOf, type AssessmentState, unopened } from './assessment-state.ts';
import { factsObserving } from './observing.ts';
import { toldOf } from './verdict-rule.ts';
import { afterMilestoneOf, opensInRun } from './window-counting.ts';

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

const released: GoalRule = {
  id: 'defects',
  per: 'release',
  window: { after: 'live', for: 'P1D' },
  success: { settles: 'on_crossing', target: { at_most: 0 } },
  milestones: [
    { id: 'built', label: 'Built', by: 'auto' },
    { id: 'live', label: 'Live', by: 'auto' },
  ],
  notify: { passed: 'now', failed: 'now' },
};

const observed = (run: string, parts: Partial<Observation>): Observation => ({
  goal: released.id,
  source: { record: `record-of-${run}`, run, workflow: 'w', version: 1, entry: 0 },
  at: 0,
  per: 'R-1',
  ...parts,
});

const observing = (goal: GoalRule, state: AssessmentState, ...observations: readonly Observation[]) =>
  factsObserving(state, { goal, goalsVersion: 1, now: 0, observations });

describe('the milestone an after window waits for', () => {
  it('is named by an after window and by no calendar window', () => {
    expect([afterMilestoneOf(released.window), afterMilestoneOf({ calendar: 'day' })]).toEqual(['live', undefined]);
  });
});

describe('the run that opens an after window', () => {
  it('is the run that first marked its milestone, and no other run nor a run that marked another milestone', () => {
    const opened = assessmentOf(observing(released, unopened, observed('run-1', { marks: 'built' })));
    const live = assessmentOf([
      ...observing(released, unopened, observed('run-1', { marks: 'built' })),
      ...observing(released, opened, observed('run-2', { marks: 'live' })),
    ]);

    expect([
      opensInRun(opened, 'run-1'),
      opensInRun(live, 'run-1'),
      opensInRun(live, 'run-2'),
      opensInRun(live, 'run-3'),
    ]).toEqual([false, false, true, false]);
  });

  it('never opens a window after a milestone the goal does not list, even from a later run that marks it', () => {
    const odd: GoalRule = { ...released, window: { after: 'unlisted', for: 'P1D' } };
    const opened = assessmentOf(observing(odd, unopened, observed('run-1', { marks: 'built' })));

    expect(observing(odd, opened, observed('run-2', { marks: 'unlisted' }))).toEqual([]);
  });
});
