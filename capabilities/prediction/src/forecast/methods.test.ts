import { describe, expect, it } from 'vitest';

import { stepsAhead, theRestOfTheWeek } from '../testing/forecast-questions.ts';
import { forecastOf } from './ladder.ts';

const weekdays = [10, 20, 30, 40, 50, 60, 70];

const threeWeeksThenADoubledWeek = [weekdays, weekdays, weekdays, weekdays.map((value) => value * 2)].flat();

interface LevelCase {
  readonly name: string;
  readonly observed: readonly (number | null)[];
  readonly value: number;
}

const levels: readonly LevelCase[] = [
  {
    name: 'the ratio of the last period to the same period a season earlier',
    observed: [1, 3, 1, 3, 1, 3, 2],
    value: 6,
  },
  { name: 'no ratio where the earlier mean is 0', observed: [1, 3, 1, 3, 0, 3, 2], value: 3 },
  { name: 'no ratio where the earlier periods are unobserved', observed: [1, 3, 1, 3, null, 3, 2], value: 3 },
  { name: 'no ratio where the last periods are unobserved', observed: [1, 3, 1, 3, 1, 3, null], value: 3 },
  { name: 'no ratio where the ratio is negative', observed: [1, 3, 1, 3, -1, 3, 2], value: 3 },
  { name: 'no ratio where the ratio is not finite', observed: [1, 3, 1, 3, 1e-300, 3, 1e300], value: 3 },
];

describe('the level-adjusted seasonal naive', () => {
  it('takes the value a season earlier times the ratio of the last k periods to the same k a season earlier, k the horizon bounded by a season', () => {
    expect(
      forecastOf({ observed: threeWeeksThenADoubledWeek, season: 7, coverage: 0.8, asked: stepsAhead(9) }),
    ).toEqual({
      method: 'level-adjusted-seasonal-naive',
      coverage: 0.8,
      season: 7,
      k: 7,
      history: { periods: 28, origins: 6 },
      points: [
        { value: 40, low: 40, high: 40 },
        { value: 80, low: 80, high: 80 },
        { value: 120, low: 120, high: 125 },
        { value: 160, low: 160, high: 175 },
        { value: 200, low: 200, high: 225 },
        { value: 240, low: 240, high: 275 },
        { value: 280, low: 280, high: 325 },
        { value: 80, low: 80, high: 135 },
        { value: 160, low: 160, high: 225 },
      ],
    });
  });

  it.each(levels)('levels the value a season earlier by $name', ({ observed, value }) => {
    expect(forecastOf({ observed, season: 2, coverage: 0.8, asked: stepsAhead(1) })).toMatchObject({
      method: 'level-adjusted-seasonal-naive',
      k: 1,
      points: [{ value }],
    });
  });

  it('keeps the value a season earlier where the level would carry it past the largest number', () => {
    expect(
      forecastOf({ observed: [1, 1, 1, 1, 1, 1e200, 1e200], season: 2, coverage: 0.5, asked: stepsAhead(1) }),
    ).toMatchObject({
      method: 'level-adjusted-seasonal-naive',
      points: [{ value: 1e200, low: 1e200, high: 1e200 + 0.25 * 1e200 }],
    });
  });
});

describe('the level-adjusted seasonal naive of a total', () => {
  it('sums its steps over the periods to the end, the level the ratio of the last periods to the same periods a season earlier', () => {
    const observed = [Array.from({ length: 35 }, () => 2), [4, 4, 4]].flat();

    expect(forecastOf({ observed, season: 7, coverage: 0.8, asked: theRestOfTheWeek(observed) })).toEqual({
      method: 'level-adjusted-seasonal-naive',
      coverage: 0.8,
      season: 7,
      k: 4,
      history: { periods: 38, origins: 3 },
      points: [{ value: 8 * ((2 + 4 + 4 + 4) / 4 / 2), low: 14, high: 14 }],
    });
  });
});

describe('the seasonal naive', () => {
  it('repeats the last season where the history holds one season but not two, its range the misses of each step a season earlier', () => {
    const observed = [1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 8, 3, 4];

    expect(forecastOf({ observed, season: 7, coverage: 0.8, asked: stepsAhead(7) })).toEqual({
      method: 'seasonal-naive',
      coverage: 0.8,
      season: 7,
      history: { periods: 16, origins: 3 },
      points: [4, 5, 6, 7, 8, 3, 4].map((value) => ({ value, low: value, high: value + 1 })),
    });
  });

  it('sums the steps of the rest of the period for a total, backtested on the same days of past weeks', () => {
    const observed = [
      [1, 1, 1, 4, 4, 4, 4],
      [1, 1, 1, 5, 5, 5, 5],
      [1, 1, 1, 4, 4, 4, 4],
      [1, 1, 1, 6, 6, 6, 6],
      [1, 1, 1],
    ].flat();

    expect(forecastOf({ observed, season: 7, coverage: 0.5, asked: theRestOfTheWeek(observed) })).toEqual({
      method: 'seasonal-naive',
      coverage: 0.5,
      season: 7,
      history: { periods: 31, origins: 3 },
      points: [{ value: 24, low: 24, high: 30 }],
    });
  });
});

describe('persistence', () => {
  it('answers the last observed value at every step, each step its own range', () => {
    expect(forecastOf({ observed: [3, 5, 4, 6, 5, 7], season: 7, coverage: 0.5, asked: stepsAhead(2) })).toEqual({
      method: 'persistence',
      coverage: 0.5,
      season: null,
      history: { periods: 6, origins: 4 },
      points: [
        { value: 7, low: 6, high: 9 },
        { value: 7, low: 7, high: 8 },
      ],
    });
  });
});

describe('the run-rate', () => {
  it('runs the mean of the periods so far over the periods to the end', () => {
    const observed = [
      [2, 2, 2, 4, 4, 4, 4],
      [3, 3, 3, 5, 5, 5, 5],
      [1, 1, 1, 6, 6, 6, 6],
      [4, 4, 4],
    ].flat();

    expect(forecastOf({ observed, season: null, coverage: 0.5, asked: theRestOfTheWeek(observed) })).toEqual({
      method: 'run-rate',
      coverage: 0.5,
      season: null,
      history: { periods: 24, origins: 3 },
      points: [{ value: 16, low: 16, high: 30 }],
    });
  });

  it('runs the mean of as many periods as are to come where none of the enclosing period has passed', () => {
    const observed = [Array.from({ length: 15 }, () => 1), Array.from({ length: 7 }, () => 3)].flat();

    expect(forecastOf({ observed, season: null, coverage: 0.5, asked: theRestOfTheWeek(observed, 0) })).toEqual({
      method: 'run-rate',
      coverage: 0.5,
      season: null,
      history: { periods: 22, origins: 3 },
      points: [{ value: 21, low: 21, high: 28 }],
    });
  });
});
