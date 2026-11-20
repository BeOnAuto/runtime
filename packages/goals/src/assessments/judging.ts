import type { GoalRule, Instant, WindowSpan } from '../goal-rules/goal-rule.ts';
import { missedAtOf } from '../goal-windows/calendar-windows.ts';
import type { AssessmentFact } from './assessment-facts.ts';
import { isUndecided, textOf, type AssessmentState, type PinnedRule } from './assessment-state.ts';
import { assessedFact, decidedBy, decidingMeasurementOf, endedFact, toldOf } from './verdict-rule.ts';

export interface Judging {
  readonly goal: GoalRule | undefined;
  readonly now: Instant;
  readonly playbookRetired: boolean;
}

function atDue(
  state: AssessmentState,
  pinned: PinnedRule,
  goal: GoalRule,
  window: WindowSpan,
): readonly AssessmentFact[] {
  const deciding = decidingMeasurementOf(state, pinned.target);
  if (deciding !== undefined) {
    return [
      assessedFact(goal, {
        verdict: decidedBy(pinned.target, deciding.value),
        at: window.due,
        by: 'final',
      }),
    ];
  }
  return [{ type: 'goal_overdue', data: { since: textOf(window.due), told: toldOf(goal, 'overdue') } }];
}

function overdueThrough(state: AssessmentState, judging: Judging, goal: GoalRule, window: WindowSpan) {
  const { pinned } = state;
  const settled = state.overdueSince === undefined && pinned !== undefined ? atDue(state, pinned, goal, window) : [];
  const verdictGiven = settled.some(({ type }) => type === 'goal_assessed');
  return judging.now >= missedAtOf(state.pinned?.window, window) && !verdictGiven
    ? [...settled, assessedFact(goal, { verdict: 'failed', at: window.due, by: 'deadline' })]
    : settled;
}

export function factsAtMoment(state: AssessmentState, judging: Judging): readonly AssessmentFact[] {
  const { goal } = judging;
  if (!isUndecided(state)) {
    return [];
  }
  if (goal === undefined || goal.retired === true) {
    return [endedFact('goal_retired')];
  }
  const { window } = state;
  if (window === undefined || judging.now < window.due) {
    return [];
  }
  return judging.playbookRetired ? [endedFact('playbook_retired')] : overdueThrough(state, judging, goal, window);
}
