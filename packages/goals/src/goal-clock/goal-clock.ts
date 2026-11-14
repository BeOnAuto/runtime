import type { AssessmentOpened } from '../assessments/assessment-facts.ts';
import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { openedData } from '../assessments/opening.ts';
import { isCalendarRule, type CalendarWindowRule, type GoalRule, type Instant } from '../goal-rules/goal-rule.ts';
import { calendarSpanAt, isJudgedSpan, judgedSpanFrom } from '../goal-windows/calendar-windows.ts';
import { utcMidnightAtOrAfter } from '../goal-windows/goal-durations.ts';

export interface GoalClock {
  readonly firstSavedAt: Instant;
  readonly latestOpened?: Instant;
  readonly armedAt?: Instant;
}

export interface ClockMoment extends GoalClock {
  readonly goal: GoalRule | undefined;
  readonly goalsVersion: number;
  readonly now: Instant;
  readonly reporting: boolean;
  readonly playbookRetired: boolean;
}

export interface WindowToOpen {
  readonly assessment: string;
  readonly opens: Instant;
  readonly opened: AssessmentOpened;
}

export interface ClockWork {
  readonly open?: WindowToOpen;
  readonly nextAt: Instant | null;
}

function calendarOf(goal: GoalRule | undefined): CalendarWindowRule | undefined {
  const window = goal?.retired === true ? undefined : goal?.window;
  return window !== undefined && isCalendarRule(window) ? window : undefined;
}

export function nextWindowOpeningOf(goal: GoalRule | undefined, clock: GoalClock): Instant | null {
  const rule = calendarOf(goal);
  return rule === undefined ? null : nextCalendarOpeningOf(rule, clock);
}

export function nextCalendarOpeningOf(rule: CalendarWindowRule, clock: GoalClock): Instant {
  if (clock.latestOpened !== undefined) {
    return judgedSpanFrom(rule, calendarSpanAt(rule, clock.latestOpened).closes).opens;
  }
  const first = calendarSpanAt(rule, clock.firstSavedAt);
  return judgedSpanFrom(rule, first.opens === clock.firstSavedAt ? first.opens : first.closes).opens;
}

function isOpenable(moment: ClockMoment, opens: Instant): boolean {
  const unopened = moment.latestOpened === undefined || moment.latestOpened < opens;
  return unopened && opens >= Math.max(moment.firstSavedAt, moment.armedAt ?? -Infinity) && moment.reporting;
}

export function clockWorkAt(moment: ClockMoment): ClockWork {
  const { goal } = moment;
  const rule = calendarOf(goal);
  if (goal === undefined || rule === undefined) {
    return { nextAt: null };
  }
  const span = calendarSpanAt(rule, moment.now);
  if (moment.playbookRetired) {
    return { nextAt: utcMidnightAtOrAfter(Math.max(span.closes, moment.now + 1)) };
  }
  if (!moment.reporting) {
    return { nextAt: null };
  }
  const nextAt = judgedSpanFrom(rule, span.closes).opens;
  if (!isJudgedSpan(rule, span) || !isOpenable(moment, span.opens)) {
    return { nextAt };
  }
  return {
    open: {
      assessment: assessmentIdOf({ goal: goal.id, window_start: span.opens }),
      opens: span.opens,
      opened: openedData(goal, moment.goalsVersion, { window: span }),
    },
    nextAt,
  };
}
