import type { Enclosing, Grain } from '@on.auto/prediction-contract';
import { describe, expect, it } from 'vitest';

import { markColumns, markedColumns, marksOf, periodsSoFar } from './periods.ts';

const soFar: readonly (readonly [Grain, number, Enclosing, number, string])[] = [
  ['day', 20_754, 'week', 3, 'Wednesday 2026-10-28, its week begun on Monday'],
  ['day', 20_751, 'week', 0, 'Sunday 2026-10-25, the last of its week'],
  ['day', 20_752, 'week', 1, 'Monday 2026-10-26'],
  ['day', 20_757, 'month', 0, 'the last day of October 2026'],
  ['day', 20_758, 'month', 1, 'the first of November 2026'],
  ['day', 20_818, 'quarter', 0, 'the last day of 2026'],
  ['day', 19_782, 'month', 0, 'the leap day of 2024'],
  ['week', 2922, 'quarter', 1, '2026-W01, the first week of its quarter'],
  ['week', 2961, 'quarter', 1, '2026-W40, whose Thursday opens the fourth quarter'],
  ['week', 2974, 'year', 0, '2026-W53, the last week of its year'],
  ['week', 2661, 'year', 0, '2020-W53'],
  ['month', 24_314, 'quarter', 0, 'March 2026, the last month of its quarter'],
  ['month', 24_323, 'year', 0, 'December 2026'],
  ['month', 24_317, 'year', 6, 'June 2026'],
];

describe('the periods of an enclosing period so far', () => {
  it.each(soFar)('from the %s %i to the end of the %s are %i: %s', (grain, origin, enclosing, periods) => {
    expect(periodsSoFar(grain, enclosing, origin)).toBe(periods);
  });
});

describe('the calendar marks of a period', () => {
  it('are the day of the week of a day, Monday first, and none of a week or a year', () => {
    expect([marksOf('day'), marksOf('week'), marksOf('year'), markColumns('none')]).toEqual([
      'day-of-week',
      'none',
      'none',
      0,
    ]);
    expect([
      markedColumns('day-of-week', 20_752),
      markedColumns('day-of-week', 20_754),
      markedColumns('day-of-week', 0),
      markedColumns('day-of-week', 20_751),
      markedColumns('day-of-week', -1),
    ]).toEqual([
      [0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 1],
      [0, 1, 0, 0, 0, 0],
    ]);
  });

  it('are the month of the year of a month and the quarter of the year of a quarter, the first as no column', () => {
    expect([marksOf('month'), marksOf('quarter'), markColumns('month-of-year')]).toEqual([
      'month-of-year',
      'quarter-of-year',
      11,
    ]);
    expect([markedColumns('month-of-year', 24_314), markedColumns('quarter-of-year', 8107)]).toEqual([
      [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1],
    ]);
  });
});
