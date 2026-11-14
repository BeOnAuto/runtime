import type { Goal } from '@on.auto/definitions/goals';
import type { RecordedCaller } from '@on.auto/operations';

import { textOf, type AssessmentState } from '../assessments/assessment-state.ts';
import { isCalendarRule, type Instant } from '../goal-rules/goal-rule.ts';
import { decidingOf, noResultYet } from '../notices/notice-input.ts';

const noResult = 'No result';

export const mostSummaryLines = 20;

export type SummarisedAs = 'passed' | 'failed' | 'overdue' | 'no_result';

export interface SummarisedAssessment {
  readonly key: string;
  readonly state: AssessmentState;
  readonly as: SummarisedAs;
  readonly at: Instant;
  readonly link?: string | undefined;
}

export type SummaryCounts = {
  readonly passed: number;
  readonly failed: number;
  readonly overdue: number;
  readonly no_result: number;
};

type SummaryLine = {
  readonly title: string;
  readonly word: string;
  readonly value?: number;
  readonly at: string;
  readonly link?: string;
};

export interface SummaryWindow {
  readonly from: Instant;
  readonly to: Instant;
}

export interface SummaryInput {
  readonly change: 'summary';
  readonly headline: string;
  readonly detail: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly counts: SummaryCounts;
  readonly lines: readonly SummaryLine[];
  readonly more: number;
  readonly link?: string;
  readonly owner: RecordedCaller;
  readonly goal: { readonly id: string; readonly statement: string };
}

export interface Summarising {
  readonly goal: Goal;
  readonly window: SummaryWindow;
  readonly assessments: readonly SummarisedAssessment[];
  readonly counts: SummaryCounts;
  readonly owner: RecordedCaller;
  readonly link?: string | undefined;
}

function wordOf({ success }: Goal, as: SummarisedAs): string {
  if (as === 'passed') {
    return success.passed;
  }
  if (as === 'failed') {
    return success.failed;
  }
  return as === 'overdue' ? noResultYet : noResult;
}

function zonedText(
  at: Instant,
  timeZone: string,
  locale: string,
  options: Readonly<Intl.DateTimeFormatOptions>,
): string {
  return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(at);
}

function dayText(at: Instant, timeZone: string): string {
  return zonedText(at, timeZone, 'en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function windowTitleOf({ pinned, window }: AssessmentState): string | undefined {
  const rule = pinned?.window;
  if (rule === undefined || window === undefined || !isCalendarRule(rule)) {
    return undefined;
  }
  const zone = rule.time_zone ?? 'UTC';
  if (rule.calendar === 'day') {
    return dayText(window.opens, zone);
  }
  return rule.calendar === 'week'
    ? `Week of ${zonedText(window.opens, zone, 'en-US', { month: 'long', day: 'numeric' })}`
    : zonedText(window.opens, zone, 'en-US', { month: 'long', year: 'numeric' });
}

function summaryZoneOf({ notify, window }: Goal): string {
  const calendarZone = window !== undefined && 'calendar' in window ? window.time_zone : undefined;
  return notify?.summary?.time_zone ?? calendarZone ?? 'UTC';
}

function titleOf(goal: Goal, state: AssessmentState): string {
  return state.title ?? state.pinned?.per ?? windowTitleOf(state) ?? goal.statement;
}

function lineOf(goal: Goal, { state, as, at, link }: SummarisedAssessment): SummaryLine {
  const value = decidingOf(state, as === 'no_result' ? 'overdue' : as)?.value;
  return {
    title: titleOf(goal, state),
    word: wordOf(goal, as),
    ...(value === undefined ? {} : { value }),
    at: textOf(at),
    ...(link === undefined ? {} : { link }),
  };
}

function lineText({ success }: Goal, { title, word, value }: SummaryLine): string {
  return value === undefined ? `${word}: ${title}` : `${word}: ${title} (${success.label}: ${String(value)})`;
}

function detailOf(goal: Goal, lines: readonly SummaryLine[], more: number, { from }: SummaryWindow): string {
  if (lines.length === 0) {
    return `Nothing passed, failed or became overdue since ${dayText(from, summaryZoneOf(goal))}.`;
  }
  const rest = more === 0 ? [] : [`and ${String(more)} more`];
  return [...lines.map((line) => lineText(goal, line)), ...rest].join('\n');
}

function totalOf({ passed, failed, overdue, no_result }: SummaryCounts): number {
  return passed + failed + overdue + no_result;
}

function headlineOf({ statement }: Goal, { passed, failed, overdue, no_result }: SummaryCounts): string {
  return `${statement.replace(/[.!?]+$/u, '')}: ${String(passed)} passed, ${String(failed)} failed, ${String(overdue + no_result)} with no result`;
}

export function summaryInputOf({ goal, window, assessments, counts, owner, link }: Summarising): SummaryInput {
  const lines = assessments.slice(0, mostSummaryLines).map((summarised) => lineOf(goal, summarised));
  const more = Math.max(totalOf(counts) - lines.length, 0);
  return {
    change: 'summary',
    headline: headlineOf(goal, counts),
    detail: detailOf(goal, lines, more, window),
    window: { from: textOf(window.from), to: textOf(window.to) },
    counts,
    lines,
    more,
    ...(link === undefined ? {} : { link }),
    owner,
    goal: { id: goal.id, statement: goal.statement },
  };
}
