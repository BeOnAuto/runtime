import { describe, expect, it } from 'vitest';

import {
  closeOf,
  enclosingOf,
  enclosings,
  longestSpanOf,
  periodsToTheEnd,
  startOfEnclosing,
  type Enclosing,
} from './enclosing.ts';
import { grains, periodForm, periodOfForm, type Grain } from './grains.ts';

function remaining(grain: Grain, enclosing: Enclosing, origin: string): readonly [number, string] {
  const at = Number(periodOfForm(grain, origin));
  return [periodsToTheEnd(grain, enclosing, at), periodForm(enclosing, enclosingOf(grain, enclosing, at + 1))];
}

function mostSpanned(grain: Grain, enclosing: Enclosing): number {
  const first = Number(periodOfForm(grain, periodForm(grain, Number(periodOfForm('day', '2000-01-01')))));
  const counts = new Map<number, number>();
  for (let period = first; period < first + 30_000; period += 1) {
    const holder = enclosingOf(grain, enclosing, period);
    counts.set(holder, (counts.get(holder) ?? 0) + 1);
  }
  return Math.max(...[...counts.values()].slice(1, -1));
}

const pairs = grains.flatMap((grain) =>
  enclosings.flatMap((enclosing) => {
    const longest = longestSpanOf(grain, enclosing);
    return longest === undefined ? [] : [[grain, enclosing, longest] as const];
  }),
);

interface Remaining {
  readonly grain: Grain;
  readonly enclosing: Enclosing;
  readonly origin: string;
  readonly periods: number;
  readonly holder: string;
}

describe('the period that encloses a period', () => {
  it.each<Remaining>([
    { grain: 'day', enclosing: 'month', origin: '2026-10-12', periods: 19, holder: '2026-10' },
    { grain: 'day', enclosing: 'month', origin: '2026-10-31', periods: 30, holder: '2026-11' },
    { grain: 'day', enclosing: 'week', origin: '2026-10-11', periods: 7, holder: '2026-W42' },
    { grain: 'day', enclosing: 'week', origin: '2026-10-13', periods: 5, holder: '2026-W42' },
    { grain: 'day', enclosing: 'quarter', origin: '2026-09-30', periods: 92, holder: '2026-Q4' },
    { grain: 'week', enclosing: 'year', origin: '2026-W52', periods: 1, holder: '2026' },
    { grain: 'week', enclosing: 'year', origin: '2026-W53', periods: 52, holder: '2027' },
    { grain: 'week', enclosing: 'quarter', origin: '2026-W40', periods: 13, holder: '2026-Q4' },
    { grain: 'month', enclosing: 'quarter', origin: '2026-10', periods: 2, holder: '2026-Q4' },
    { grain: 'month', enclosing: 'year', origin: '2026-12', periods: 12, holder: '2027' },
  ])(
    'of a $grain, summed to the end of its $enclosing, counts from $origin the periods after it, $periods, to the end of $holder',
    ({ grain, enclosing, origin, periods, holder }) => {
      expect(remaining(grain, enclosing, origin)).toEqual([periods, holder]);
    },
  );

  it.each<readonly [Grain, Enclosing, string, string]>([
    ['day', 'month', '2026-10-12', '2026-10-01'],
    ['day', 'week', '2026-10-11', '2026-10-05'],
    ['week', 'quarter', '2026-W40', '2026-W40'],
    ['week', 'year', '2027-W02', '2027-W01'],
    ['month', 'year', '2026-10', '2026-01'],
  ])('of a %s in its %s starts, for %s, at %s', (grain, enclosing, period, first) => {
    expect(periodForm(grain, startOfEnclosing(grain, enclosing, Number(periodOfForm(grain, period))))).toBe(first);
  });

  it('holds a week in the quarter and the year of its Thursday, as ISO 8601 gives a week its year', () => {
    expect([
      periodForm('quarter', enclosingOf('week', 'quarter', Number(periodOfForm('week', '2026-W27')))),
      periodForm('year', enclosingOf('week', 'year', Number(periodOfForm('week', '2026-W01')))),
    ]).toEqual(['2026-Q3', '2026']);
  });
});

describe('the close of a period', () => {
  it.each<readonly [Grain, string, string]>([
    ['day', '2026-10-12', '2026-10-13T00:00:00.000Z'],
    ['week', '2026-W42', '2026-10-19T00:00:00.000Z'],
    ['month', '2026-12', '2027-01-01T00:00:00.000Z'],
    ['quarter', '2026-Q4', '2027-01-01T00:00:00.000Z'],
    ['year', '2026', '2027-01-01T00:00:00.000Z'],
  ])('of a %s comes, for %s, at the start of the next, %s', (grain, period, close) => {
    expect(new Date(closeOf(grain, Number(periodOfForm(grain, period)))).toISOString()).toBe(close);
  });
});

describe('the longest span of a period summed to the period that encloses it', () => {
  it.each(pairs)('of a %s summed to its %s is %s of them, the longest a question asks', (grain, of, most) => {
    expect(mostSpanned(grain, of)).toBe(most);
  });

  it('is admitted for a day to a week, a month or a quarter, a week to a quarter or a year, and a month to a quarter or a year', () => {
    expect(pairs.map(([grain, of]) => `${grain}:${of}`)).toEqual([
      'day:week',
      'day:month',
      'day:quarter',
      'week:quarter',
      'week:year',
      'month:quarter',
      'month:year',
    ]);
  });
});
