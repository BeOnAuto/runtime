import { zoneClockOf, type ZoneClock } from '@on.auto/workflow-host';

import {
  isCalendarRule,
  type AfterWindowRule,
  type CalendarUnit,
  type CalendarWindowRule,
  type Instant,
  type WindowRule,
  type WindowSpan,
} from '../goal-rules/goal-rule.ts';
import { aDay, exactDurationMsOf, graceMsOf } from './goal-durations.ts';

const universalTime = 'UTC';

const daysInAWeek = 7;

const zoneClocks = new Map<string, ZoneClock>();

export function zoneClockIn(timeZone: string): ZoneClock {
  const kept = zoneClocks.get(timeZone);
  if (kept !== undefined) {
    return kept;
  }
  const made = zoneClockOf(timeZone);
  zoneClocks.set(timeZone, made);
  return made;
}

interface WallSpan {
  readonly start: number;
  readonly end: number;
}

function wallSpanOf(unit: CalendarUnit, wallClock: number): WallSpan {
  const day = new Date(wallClock);
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth();
  const date = day.getUTCDate();
  if (unit === 'month') {
    return { start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1) };
  }
  const midnight = Date.UTC(year, month, date);
  if (unit === 'day') {
    return { start: midnight, end: midnight + aDay };
  }
  const monday = midnight - ((day.getUTCDay() + daysInAWeek - 1) % daysInAWeek) * aDay;
  return { start: monday, end: monday + daysInAWeek * aDay };
}

export function calendarSpanAt(rule: CalendarWindowRule, instant: Instant): WindowSpan {
  const clock = zoneClockIn(rule.time_zone ?? universalTime);
  const wall = wallSpanOf(rule.calendar, clock.wallClockAt(instant));
  const closes = clock.firstInstantReaching(wall.end);
  return { opens: clock.firstInstantReaching(wall.start), closes, due: closes + graceMsOf(rule.grace) };
}

const weekdaysFromSunday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function isJudgedSpan(rule: CalendarWindowRule, span: WindowSpan): boolean {
  if (rule.calendar !== 'day' || rule.days === undefined) {
    return true;
  }
  const wall = new Date(zoneClockIn(rule.time_zone ?? universalTime).wallClockAt(span.opens));
  const weekday = weekdaysFromSunday[wall.getUTCDay()];
  return rule.days.some((day) => day === weekday);
}

function spansFrom(rule: CalendarWindowRule, span: WindowSpan, more: number): readonly WindowSpan[] {
  return more === 0 ? [span] : [span, ...spansFrom(rule, calendarSpanAt(rule, span.closes), more - 1)];
}

export function judgedSpanFrom(rule: CalendarWindowRule, instant: Instant): WindowSpan {
  const first = calendarSpanAt(rule, instant);
  return spansFrom(rule, first, daysInAWeek).find((span) => isJudgedSpan(rule, span)) ?? first;
}

export function calendarSpanHolding(rule: CalendarWindowRule, asOf: Instant): WindowSpan {
  return calendarSpanAt(rule, asOf - 1);
}

export function afterSpanFrom(rule: AfterWindowRule, markedAt: Instant): WindowSpan {
  const closes = markedAt + (exactDurationMsOf(rule.for) ?? 0);
  return { opens: markedAt, closes, due: closes + graceMsOf(rule.grace) };
}

export function holds(rule: WindowRule, span: WindowSpan, asOf: Instant): boolean {
  const opened = isCalendarRule(rule) ? span.opens < asOf : span.opens <= asOf;
  return opened && asOf <= span.closes;
}

export function missedAtOf(rule: WindowRule | undefined, span: WindowSpan): Instant {
  return rule !== undefined && isCalendarRule(rule)
    ? calendarSpanAt(rule, span.closes).due
    : span.due + (span.closes - span.opens);
}
