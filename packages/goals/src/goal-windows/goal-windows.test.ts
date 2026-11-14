import { describe, expect, it } from 'vitest';

import { isCalendarRule } from '../goal-rules/goal-rule.ts';
import {
  afterSpanFrom,
  calendarSpanAt,
  calendarSpanHolding,
  holds,
  isJudgedSpan,
  judgedSpanFrom,
  missedAtOf,
} from './calendar-windows.ts';
import { aDay, anHour, exactDurationMsOf, graceMsOf } from './goal-durations.ts';

const at = (text: string) => Date.parse(text);

describe('an exact duration', () => {
  it.each([
    ['PT1M', 60_000],
    ['PT1H', anHour],
    ['P1D', aDay],
    ['P7D', 7 * aDay],
    ['P2W', 14 * aDay],
    ['P1DT2H30M', aDay + 2.5 * anHour],
    ['P90D', 90 * aDay],
  ])('reads %s', (text, milliseconds) => {
    expect(exactDurationMsOf(text)).toBe(milliseconds);
  });

  it.each(['P', 'PT', 'P1Y', 'P1M', 'PT1S', '1D', 'P1.5D', ''])('is no duration in %j', (text) => {
    expect(exactDurationMsOf(text)).toBeUndefined();
  });

  it('gives a grace of an hour when none is written, and when what is written cannot be read', () => {
    expect([graceMsOf(), graceMsOf('P1D'), graceMsOf('soon')]).toEqual([anHour, aDay, anHour]);
  });
});

describe('a calendar window', () => {
  it('is a day from midnight to midnight in UTC, due a grace after it closes', () => {
    expect(calendarSpanAt({ calendar: 'day' }, at('2026-11-09T09:00:00Z'))).toEqual({
      opens: at('2026-11-09T00:00:00Z'),
      closes: at('2026-11-10T00:00:00Z'),
      due: at('2026-11-10T01:00:00Z'),
    });
  });

  it('holds the instant it opens at, so the clock opens the day at midnight', () => {
    expect(calendarSpanAt({ calendar: 'day' }, at('2026-11-09T00:00:00Z')).opens).toBe(at('2026-11-09T00:00:00Z'));
  });

  it('starts a week on Monday, also when the instant is a Sunday', () => {
    const sunday = calendarSpanAt({ calendar: 'week', grace: 'PT8H' }, at('2026-11-15T23:00:00Z'));

    expect(sunday).toEqual({
      opens: at('2026-11-09T00:00:00Z'),
      closes: at('2026-11-16T00:00:00Z'),
      due: at('2026-11-16T08:00:00Z'),
    });
  });

  it('is a month from its first day to the next, across the turn of a year', () => {
    expect(calendarSpanAt({ calendar: 'month' }, at('2026-12-31T23:59:00Z'))).toEqual({
      opens: at('2026-12-01T00:00:00Z'),
      closes: at('2027-01-01T00:00:00Z'),
      due: at('2027-01-01T01:00:00Z'),
    });
  });
});

describe('a calendar window across a change of the clocks', () => {
  it('is a day of 23 hours in Los Angeles when the clocks go forward, and 25 when they go back', () => {
    const forward = calendarSpanAt({ calendar: 'day', time_zone: 'America/Los_Angeles' }, at('2026-03-08T20:00:00Z'));
    const back = calendarSpanAt({ calendar: 'day', time_zone: 'America/Los_Angeles' }, at('2026-11-01T20:00:00Z'));

    expect([forward.opens, forward.closes - forward.opens]).toEqual([at('2026-03-08T08:00:00Z'), 23 * anHour]);
    expect([back.opens, back.closes - back.opens]).toEqual([at('2026-11-01T07:00:00Z'), 25 * anHour]);
  });

  it('is a week of 167 hours in Los Angeles across the spring change, and 169 across the autumn one', () => {
    const spring = calendarSpanAt({ calendar: 'week', time_zone: 'America/Los_Angeles' }, at('2026-03-05T12:00:00Z'));
    const autumn = calendarSpanAt({ calendar: 'week', time_zone: 'America/Los_Angeles' }, at('2026-10-30T12:00:00Z'));

    expect(spring).toEqual({
      opens: at('2026-03-02T08:00:00Z'),
      closes: at('2026-03-09T07:00:00Z'),
      due: at('2026-03-09T08:00:00Z'),
    });
    expect(autumn.closes - autumn.opens).toBe(169 * anHour);
  });
});

describe('the edges of a calendar window', () => {
  it('holds a measurement taken through its close, and not one taken through its opening', () => {
    const rule = { calendar: 'day' } as const;
    const monday = calendarSpanAt(rule, at('2026-11-09T12:00:00Z'));

    expect(calendarSpanHolding(rule, at('2026-11-10T00:00:00Z'))).toEqual(monday);
    expect(calendarSpanHolding(rule, at('2026-11-09T00:00:00Z')).closes).toBe(monday.opens);
    expect([
      holds(rule, monday, monday.opens),
      holds(rule, monday, monday.closes),
      holds(rule, monday, monday.closes + 1),
    ]).toEqual([false, true, false]);
  });

  it('is missed one more window length after its due', () => {
    const rule = { calendar: 'day' } as const;

    expect(missedAtOf(rule, calendarSpanAt(rule, at('2026-11-10T09:00:00Z')))).toBe(at('2026-11-12T01:00:00Z'));
  });

  it('is missed at the next window due when a day is short', () => {
    const rule = { calendar: 'day', time_zone: 'America/Los_Angeles', grace: 'PT1H' } as const;
    const sunday = calendarSpanAt(rule, at('2026-03-08T12:00:00Z'));

    expect([sunday.due, missedAtOf(rule, sunday)]).toEqual([at('2026-03-09T08:00:00Z'), at('2026-03-10T08:00:00Z')]);
  });

  it('is missed at the next month due rather than a month of its own length later', () => {
    const rule = { calendar: 'month' } as const;

    expect(missedAtOf(rule, calendarSpanAt(rule, at('2026-01-15T00:00:00Z')))).toBe(at('2026-03-01T01:00:00Z'));
  });

  it('is missed after a milestone one more window length after its due', () => {
    const rule = { after: 'live', for: 'P7D', grace: 'P1D' } as const;

    expect(missedAtOf(rule, afterSpanFrom(rule, at('2026-11-02T10:00:00Z')))).toBe(at('2026-11-17T10:00:00Z'));
  });

  it('is told apart from a window after a milestone', () => {
    expect([isCalendarRule({ calendar: 'day' }), isCalendarRule({ after: 'live', for: 'P7D' })]).toEqual([true, false]);
  });
});

describe('a daily window judged on some days of the week', () => {
  const weekdays = {
    calendar: 'day',
    time_zone: 'America/Los_Angeles',
    days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  } as const;

  it('is judged on the days it names, by the day in its own time zone', () => {
    const friday = calendarSpanAt(weekdays, at('2026-11-14T07:00:00Z'));
    const saturday = calendarSpanAt(weekdays, at('2026-11-14T09:00:00Z'));

    expect([isJudgedSpan(weekdays, friday), isJudgedSpan(weekdays, saturday)]).toEqual([true, false]);
  });

  it('is judged every day when it names no days, and a weekly window is judged every week', () => {
    const sunday = at('2026-11-15T12:00:00Z');

    expect([
      isJudgedSpan({ calendar: 'day' }, calendarSpanAt({ calendar: 'day' }, sunday)),
      isJudgedSpan({ calendar: 'week', days: ['monday'] }, calendarSpanAt({ calendar: 'week' }, sunday)),
    ]).toEqual([true, true]);
  });

  it('moves on from a day it does not judge to the next day it does', () => {
    expect([
      judgedSpanFrom(weekdays, at('2026-11-14T12:00:00Z')).opens,
      judgedSpanFrom(weekdays, at('2026-11-13T12:00:00Z')).opens,
      judgedSpanFrom({ ...weekdays, days: ['sunday'] }, at('2026-11-16T12:00:00Z')).opens,
    ]).toEqual([at('2026-11-16T08:00:00Z'), at('2026-11-13T08:00:00Z'), at('2026-11-22T08:00:00Z')]);
  });

  it('stays on the day it was asked about when it names no day at all', () => {
    expect(judgedSpanFrom({ ...weekdays, days: [] }, at('2026-11-14T12:00:00Z')).opens).toBe(
      at('2026-11-14T08:00:00Z'),
    );
  });
});

describe('a window after a milestone', () => {
  it('starts when the milestone is marked, closes its length later and is due a grace after that', () => {
    expect(afterSpanFrom({ after: 'live', for: 'P7D', grace: 'P1D' }, at('2026-11-02T10:00:00Z'))).toEqual({
      opens: at('2026-11-02T10:00:00Z'),
      closes: at('2026-11-09T10:00:00Z'),
      due: at('2026-11-10T10:00:00Z'),
    });
  });

  it('has no length when its length cannot be read', () => {
    const span = afterSpanFrom({ after: 'live', for: 'a while' }, 0);

    expect([span.closes, span.due]).toEqual([0, anHour]);
  });

  it('holds a measurement taken through the instant it opens, since no earlier window claims it', () => {
    const rule = { after: 'live', for: 'P7D' } as const;
    const live = afterSpanFrom(rule, at('2026-11-02T10:00:00Z'));

    expect([
      holds(rule, live, live.opens - 1),
      holds(rule, live, live.opens),
      holds(rule, live, live.closes),
      holds(rule, live, live.closes + 1),
    ]).toEqual([false, true, true, false]);
  });
});
