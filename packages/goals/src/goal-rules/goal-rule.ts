import type { Weekday } from '@on.auto/definitions/goals';

export type Instant = number;

export type Settles = 'on_crossing' | 'at_close';

export type Told = 'now' | 'summary' | 'quiet';

export type CalendarUnit = 'day' | 'week' | 'month';

export type Target = { readonly at_least: number } | { readonly at_most: number };

export type Verdict = 'passed' | 'failed';

export interface MilestoneRule {
  readonly id: string;
  readonly label: string;
  readonly by: 'person' | 'auto';
}

export interface AfterWindowRule {
  readonly after: string;
  readonly for: string;
  readonly grace?: string;
}

export interface CalendarWindowRule {
  readonly calendar: CalendarUnit;
  readonly time_zone?: string;
  readonly grace?: string;
  readonly days?: readonly Weekday[];
}

export type WindowRule = AfterWindowRule | CalendarWindowRule;

export interface GoalRule {
  readonly id: string;
  readonly per?: string;
  readonly window?: WindowRule;
  readonly success: {
    readonly settles: Settles;
    readonly target: Target;
  };
  readonly milestones?: readonly MilestoneRule[];
  readonly notify?: {
    readonly passed: Told;
    readonly failed: Told;
    readonly overdue?: Told;
  };
  readonly retired?: boolean;
}

export interface WindowSpan {
  readonly opens: Instant;
  readonly closes: Instant;
  readonly due: Instant;
}

export function isCalendarRule(rule: WindowRule): rule is CalendarWindowRule {
  return 'calendar' in rule;
}
