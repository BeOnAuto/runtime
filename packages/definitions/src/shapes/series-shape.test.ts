import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rangeHolds } from '../index.ts';
import { shapeNamed } from '../testing/index.ts';

const { check } = shapeNamed('series');

interface Around {
  readonly unit?: string;
  readonly period?: Schema.Json;
  readonly origin?: string;
  readonly marks?: readonly Schema.Json[];
}

function pointsAt(...ats: readonly string[]): readonly Schema.Json[] {
  return ats.map((at, index) => ({ at, value: index }));
}

function seriesOf(points: readonly Schema.Json[], around: Around = {}): Schema.Json {
  return { ...around, lines: [{ name: 'Only', points }] };
}

function linesOf(count: number, points: number): Schema.Json {
  return {
    period: 'day',
    lines: Array.from({ length: count }, (_, line) => ({
      name: `Line ${line}`,
      points: Array.from({ length: points }, (__, index) => ({
        at: new Date(Date.UTC(2000, 0, 1 + index)).toISOString().slice(0, 10),
        value: index,
      })),
    })),
  };
}

function named(name: string): Schema.Json {
  return { lines: [{ name, points: [] }] };
}

function marksOf(count: number): readonly Schema.Json[] {
  return Array.from({ length: count }, (_, index) => ({ label: `M${index}`, value: index }));
}

describe('the lines of a series', () => {
  it('are 1 to 20, with at most 2,000 points in all', () => {
    expect([check(linesOf(1, 0)), check(linesOf(20, 100)), check(linesOf(2, 1000))]).toEqual([[], [], []]);
    expect(check(linesOf(0, 0))).toEqual([
      { pointer: '/lines', detail: 'Expected a value with a length of at least 1' },
    ]);
    expect(check(linesOf(21, 0))).toEqual([
      { pointer: '/lines', detail: 'Expected a value with a length of at most 20' },
    ]);
    expect(check(linesOf(3, 667))).toEqual([
      { pointer: '/lines', detail: 'Expected at most 2,000 points across the lines' },
    ]);
    expect(check(linesOf(1, 2001))).toEqual([
      { pointer: '/lines/0/points', detail: 'Expected a value with a length of at most 2000' },
      { pointer: '/lines', detail: 'Expected at most 2,000 points across the lines' },
    ]);
  });

  it('are each named, with a name of 1 to 64 characters that no line before it has', () => {
    expect(check(named('x'.repeat(64)))).toEqual([]);
    expect([check(named('')), check(named('x'.repeat(65)))]).toEqual([
      [{ pointer: '/lines/0/name', detail: 'Expected a value with a length of at least 1' }],
      [{ pointer: '/lines/0/name', detail: 'Expected a string with at most 64 code points' }],
    ]);
    expect(
      check({
        lines: [
          { name: 'Same', points: [] },
          { name: 'Other', points: [] },
          { name: 'Same', points: [] },
        ],
      }),
    ).toEqual([{ pointer: '/lines/2/name', detail: 'Expected a name no line before it has' }]);
  });
});

describe('a series', () => {
  it('takes a unit of 1 to 64 characters, a period of a known grain and at most 8 marks, each a value with a label', () => {
    expect(check(seriesOf([], { unit: 'm', period: 'year', marks: marksOf(8) }))).toEqual([]);
    expect(check(seriesOf([], { unit: '', period: 'hour', marks: marksOf(9) }))).toEqual([
      { pointer: '/unit', detail: 'Expected a value with a length of at least 1' },
      { pointer: '/period', detail: 'Expected "day" | "week" | "month" | "quarter" | "year"' },
      { pointer: '/marks', detail: 'Expected a value with a length of at most 8' },
    ]);
    expect(check(seriesOf([], { marks: [{ label: 'Goal' }] }))).toEqual([
      { pointer: '/marks/0/value', detail: 'Missing key' },
    ]);
  });

  it('takes nothing it does not describe, at any level', () => {
    expect(
      check({
        lines: [{ name: 'A', points: [{ at: '2026-01-01T00:00:00Z', value: 1, note: 'x' }], color: 'red' }],
        kind: 'x',
      }),
    ).toEqual([
      { pointer: '/kind', detail: 'Expected no excess property' },
      { pointer: '/lines/0/color', detail: 'Expected no excess property' },
      { pointer: '/lines/0/points/0/note', detail: 'Expected no excess property' },
    ]);
  });
});

describe('the at of a point', () => {
  it('is a date and time of RFC 3339 when the series names no period', () => {
    expect(
      check(seriesOf(pointsAt('2026-10-15T09:30:00Z', '2026-10-15T11:30:00.5+01:00', '2026-10-15t11:00:00z'))),
    ).toEqual([]);
    expect(check(seriesOf(pointsAt('2026-10-15')))).toEqual([
      {
        pointer: '/lines/0/points/0/at',
        detail: 'Expected an RFC 3339 date and time, such as 2026-10-15T09:30:00Z',
      },
    ]);
    expect(
      check(seriesOf(pointsAt('2026-02-29T00:00:00Z', '2026-10-15T24:00:00Z', '2026-10-15T09:30:00+24:00'))),
    ).toHaveLength(3);
  });

  it('is the period of the grain the series names, in its ISO 8601 form', () => {
    const forms: readonly (readonly [string, string, string])[] = [
      ['day', '2024-02-29', '2026-02-29'],
      ['week', '2026-W53', '2027-W53'],
      ['month', '2026-12', '2026-13'],
      ['quarter', '2026-Q4', '2026-Q5'],
      ['year', '2026', '26'],
    ];

    expect(forms.map(([period, valid]) => check(seriesOf(pointsAt(valid), { period })))).toEqual(forms.map(() => []));
    expect(forms.map(([period, , invalid]) => check(seriesOf(pointsAt(invalid), { period })).at(0))).toMatchObject([
      { detail: 'Expected a day in the form YYYY-MM-DD' },
      { detail: 'Expected a week in the form YYYY-Www' },
      { detail: 'Expected a month in the form YYYY-MM' },
      { detail: 'Expected a quarter in the form YYYY-Qn' },
      { detail: 'Expected a year in the form YYYY' },
    ]);
  });

  it('is not read for its form under a period the series does not know, which the schema refuses', () => {
    expect(check(seriesOf(pointsAt('2026-01', 'soon'), { period: 'hour', origin: 'now' }))).toEqual([
      { pointer: '/period', detail: 'Expected "day" | "week" | "month" | "quarter" | "year"' },
    ]);
    expect(check(seriesOf(pointsAt('soon'), { period: 5 }))).toEqual([
      { pointer: '/period', detail: 'Expected "day" | "week" | "month" | "quarter" | "year"' },
    ]);
  });
});

describe('the order of the points of a line', () => {
  it('puts each later than the point before it', () => {
    expect(check(seriesOf(pointsAt('2026-Q1', '2026-Q3', '2026-Q2', '2026-Q4'), { period: 'quarter' }))).toEqual([
      { pointer: '/lines/0/points/2/at', detail: 'Expected a time later than the point before it' },
    ]);
    expect(check(seriesOf(pointsAt('2026-10-15T10:00:00+01:00', '2026-10-15T09:00:00Z')))).toEqual([
      { pointer: '/lines/0/points/1/at', detail: 'Expected a time later than the point before it' },
    ]);
    expect(check(seriesOf(pointsAt('2026-01', '2026-01'), { period: 'month' }))).toHaveLength(1);
  });

  it('compares a point with the last one of its line in its form, past one that is not', () => {
    expect(check(seriesOf(pointsAt('2026-01', 'soon', '2026-02'), { period: 'month' }))).toEqual([
      { pointer: '/lines/0/points/1/at', detail: 'Expected a month in the form YYYY-MM' },
    ]);
  });
});

describe('the origin of a series', () => {
  it('is the at of the last point observed, in the form of every at', () => {
    expect(check(seriesOf(pointsAt('2026-W01'), { period: 'week', origin: '2026-W01' }))).toEqual([]);
    expect(check(seriesOf(pointsAt('2026-W01'), { period: 'week', origin: '2026-01-05' }))).toEqual([
      { pointer: '/origin', detail: 'Expected a week in the form YYYY-Www' },
    ]);
  });
});

describe('the value of a point', () => {
  it('lies between its low and its high, where it has them', () => {
    expect(check(seriesOf([{ at: '2026-01-01T00:00:00Z', value: 2, low: 2, high: 2 }]))).toEqual([]);
    expect(check(seriesOf([{ at: '2026-01-01T00:00:00Z', value: 2, low: 3, high: 1 }]))).toEqual([
      { pointer: '/lines/0/points/0/low', detail: 'Expected a low of at most the value' },
      { pointer: '/lines/0/points/0/high', detail: 'Expected a high of at least the value' },
    ]);
  });

  it('holds its range when its low is at most it and its high at least it, each where given', () => {
    expect([
      rangeHolds({ low: 1, value: 2, high: 3 }),
      rangeHolds({ low: 2, value: 2, high: 2 }),
      rangeHolds({ value: 2 }),
      rangeHolds({ low: 3, value: 2, high: 4 }),
      rangeHolds({ low: 1, value: 2, high: 1.5 }),
    ]).toEqual([true, true, true, false, false]);
  });

  it('is a number, and its point is not read further without one', () => {
    expect(check(seriesOf([{ at: 7, value: 'x', low: 3 }]))).toEqual([
      { pointer: '/lines/0/points/0/at', detail: 'Expected string' },
      { pointer: '/lines/0/points/0/value', detail: 'Expected number' },
    ]);
  });
});

describe('a value that is no series', () => {
  it('is refused by the schema alone', () => {
    expect([check('series'), check({ lines: 'many' }), check({ lines: [7, { name: 'A', points: 'few' }] })]).toEqual([
      [{ pointer: '', detail: 'Expected object' }],
      [{ pointer: '/lines', detail: 'Expected array' }],
      [
        { pointer: '/lines/0', detail: 'Expected object' },
        { pointer: '/lines/1/points', detail: 'Expected array' },
      ],
    ]);
  });
});
