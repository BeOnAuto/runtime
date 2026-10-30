import { describe, expect, it } from 'vitest';

import { civilOfDay, civilDay, daysInMonth } from './civil-days.ts';
import { grainOfForm, periodForm, periodOfForm, type Grain } from './grains.ts';
import { momentOf, periodOfMoment } from './moments.ts';

function formAt(grain: Grain, time: string): string {
  return periodForm(grain, periodOfMoment(grain, Number(momentOf(time))));
}

describe('a period of a grain', () => {
  it.each<readonly [Grain, string, string]>([
    ['day', '2026-10-12T23:59:59.999Z', '2026-10-12'],
    ['day', '2026-10-12T23:30:00-01:00', '2026-10-13'],
    ['week', '2026-10-12T00:00:00Z', '2026-W42'],
    ['week', '2026-10-11T23:59:59Z', '2026-W41'],
    ['week', '2025-12-29T00:00:00Z', '2026-W01'],
    ['week', '2027-01-01T12:00:00Z', '2026-W53'],
    ['week', '2021-01-03T12:00:00Z', '2020-W53'],
    ['month', '2026-02-28T12:00:00Z', '2026-02'],
    ['quarter', '2026-03-31T23:59:59Z', '2026-Q1'],
    ['quarter', '2026-04-01T00:00:00Z', '2026-Q2'],
    ['quarter', '2026-12-31T00:00:00Z', '2026-Q4'],
    ['year', '2026-12-31T23:59:59Z', '2026'],
    ['day', '1969-12-31T23:00:00Z', '1969-12-31'],
    ['week', '1970-01-01T00:00:00Z', '1970-W01'],
  ])('of %s holds %s in UTC as %s, weeks from Monday and quarters on calendar months', (grain, time, form) => {
    expect(formAt(grain, time)).toBe(form);
  });

  it.each<readonly [Grain, string]>([
    ['day', '2024-02-29'],
    ['week', '2026-W53'],
    ['week', '2020-W01'],
    ['month', '0000-01'],
    ['quarter', '9999-Q4'],
    ['year', '2026'],
  ])('of %s is read back from its form %s', (grain, form) => {
    expect(periodForm(grain, Number(periodOfForm(grain, form)))).toBe(form);
    expect(grainOfForm(form)).toBe(grain);
  });
});

describe('a form that names no period of a grain', () => {
  it.each<readonly [Grain, string]>([
    ['day', '2026-02-29'],
    ['day', '2026-13-01'],
    ['week', '2025-W53'],
    ['week', '2026-W00'],
    ['month', '2026-13'],
    ['quarter', '2026-Q5'],
    ['year', '26'],
    ['day', '2026-W01'],
  ])('of %s is not read from %s', (grain, form) => {
    expect(periodOfForm(grain, form)).toBeUndefined();
  });

  it('follow one another, so the index of the next is one more', () => {
    expect(periodOfForm('week', '2027-W01')).toBe(Number(periodOfForm('week', '2026-W53')) + 1);
    expect(periodOfForm('quarter', '2027-Q1')).toBe(Number(periodOfForm('quarter', '2026-Q4')) + 1);
    expect(periodOfForm('month', '2027-01')).toBe(Number(periodOfForm('month', '2026-12')) + 1);
    expect(grainOfForm('2026-10-12T00:00:00Z')).toBeUndefined();
  });
});

describe('the days of the calendar', () => {
  it('round-trip from 0000 to 9999, with leap years as the Gregorian calendar has them', () => {
    const days = [civilDay({ year: 0, month: 3, day: 1 }), civilDay({ year: 9999, month: 12, day: 31 })];

    expect(days.map((day) => civilOfDay(day))).toEqual([
      { year: 0, month: 3, day: 1 },
      { year: 9999, month: 12, day: 31 },
    ]);
    expect([daysInMonth(2000, 2), daysInMonth(1900, 2), daysInMonth(2024, 2), daysInMonth(2026, 13)]).toEqual([
      29, 28, 29, 0,
    ]);
  });
});

describe('a moment written in ISO 8601', () => {
  it.each([
    ['2026-10-12T10:00Z', Date.UTC(2026, 9, 12, 10)],
    ['2026-10-12t10:00:00z', Date.UTC(2026, 9, 12, 10)],
    ['2026-10-12T10:00:00.5+02:00', Date.UTC(2026, 9, 12, 8, 0, 0, 500)],
    ['2026-10-12T10:00:00.123456789-02:30', Date.UTC(2026, 9, 12, 12, 30, 0, 123)],
  ])('is read from %s', (text, moment) => {
    expect(momentOf(text)).toBe(moment);
  });

  it.each([
    '2016-12-31T23:59:60Z',
    '2026-10-12',
    '2026-02-30T00:00:00Z',
    '2026-10-12T24:00:00Z',
    '2026-10-12T10:60:00Z',
    '2026-10-12T10:00:00',
    '2026-10-12T10:00:00+24:00',
    '2026-10-12T10:00:00+02:60',
    '0000-01-01T00:00:00+01:00',
    '9999-12-31T23:00:00-01:00',
    'October 12, 2026',
    '+002026-10-12T00:00:00Z',
  ])(
    'is not read from %s, which names a leap second, a day without its time, no day of the calendar, no offset or no year from 0000 to 9999',
    (text) => {
      expect(momentOf(text)).toBeUndefined();
    },
  );
});
