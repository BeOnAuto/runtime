import { isCalendarRule, type CalendarWindowRule, type GoalRule, type WindowSpan } from '../goal-rules/goal-rule.ts';
import { calendarSpanHolding, isJudgedSpan } from '../goal-windows/calendar-windows.ts';
import type { Observation } from '../observations/observation.ts';
import type { AssessmentFact, AssessmentOpened } from './assessment-facts.ts';
import { textOf } from './assessment-state.ts';

interface Opening {
  readonly per?: string;
  readonly window?: WindowSpan;
}

export function openedData(goal: GoalRule, goalsVersion: number, opening: Opening): AssessmentOpened {
  const { window } = opening;
  return {
    goal: goal.id,
    goals_version: goalsVersion,
    ...(opening.per === undefined ? {} : { per: { id: opening.per } }),
    ...(window === undefined
      ? {}
      : { window: { opens: textOf(window.opens), closes: textOf(window.closes), due: textOf(window.due) } }),
    rule: {
      settles: goal.success.settles,
      target: goal.success.target,
      ...(goal.window === undefined ? {} : { window: goal.window }),
    },
    milestones: (goal.milestones ?? []).map(({ id, label, by }) => ({ id, label, by })),
  };
}

export function openedFact(data: AssessmentOpened): AssessmentFact {
  return { type: 'goal_assessment_opened', data };
}

function calendarOpeningOf(
  goal: GoalRule,
  goalsVersion: number,
  window: CalendarWindowRule,
  observation: Observation,
): AssessmentOpened | undefined {
  const span = calendarSpanHolding(window, observation.measurement?.as_of ?? observation.at);
  const current = span.opens === calendarSpanHolding(window, observation.at).opens;
  return current && isJudgedSpan(window, span) ? openedData(goal, goalsVersion, { window: span }) : undefined;
}

export function openingOf(
  goal: GoalRule,
  goalsVersion: number,
  observation: Observation,
): AssessmentOpened | undefined {
  const { window } = goal;
  if (window !== undefined && isCalendarRule(window)) {
    return calendarOpeningOf(goal, goalsVersion, window, observation);
  }
  const milestones = goal.milestones ?? [];
  if (milestones.length > 0 && !milestones.some(({ id }) => id === observation.marks)) {
    return undefined;
  }
  return openedData(goal, goalsVersion, observation.per === undefined ? {} : { per: observation.per });
}
