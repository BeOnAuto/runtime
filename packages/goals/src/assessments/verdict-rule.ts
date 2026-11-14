import type { GoalRule, Instant, Target, Told, Verdict } from '../goal-rules/goal-rule.ts';
import type { ObservationSource } from '../observations/observation.ts';
import type { AssessmentFact, JudgedBy } from './assessment-facts.ts';
import { textOf } from './assessment-state.ts';

export function crossingOf(target: Target, value: number): Verdict | undefined {
  if ('at_least' in target) {
    return value >= target.at_least ? 'passed' : undefined;
  }
  return value > target.at_most ? 'failed' : undefined;
}

export function decidedBy(target: Target, value: number): Verdict {
  if ('at_least' in target) {
    return value >= target.at_least ? 'passed' : 'failed';
  }
  return value <= target.at_most ? 'passed' : 'failed';
}

export function toldOf(goal: GoalRule, change: Verdict | 'overdue'): Told {
  return (change === 'overdue' ? goal.notify?.overdue : goal.notify?.[change]) ?? 'quiet';
}

interface Assessed {
  readonly verdict: Verdict;
  readonly at: Instant;
  readonly by: JudgedBy;
  readonly source?: ObservationSource;
}

export function assessedFact(goal: GoalRule, assessed: Assessed): AssessmentFact {
  return {
    type: 'goal_assessed',
    data: {
      verdict: assessed.verdict,
      at: textOf(assessed.at),
      by: assessed.by,
      told: toldOf(goal, assessed.verdict),
      ...(assessed.source === undefined ? {} : { source: assessed.source }),
    },
  };
}

export function endedFact(reason: 'no_result' | 'goal_retired' | 'playbook_retired'): AssessmentFact {
  return { type: 'goal_assessment_ended', data: { reason } };
}
