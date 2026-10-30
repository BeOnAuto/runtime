import { describe, expect, it } from 'vitest';

import { stepsAhead, theRestOfTheWeek } from '../testing/forecast-questions.ts';
import { forecastOf, type ForecastQuestion } from './ladder.ts';

describe('the history', () => {
  it('counts the periods from the first observed value to the origin', () => {
    expect([
      forecastOf({ observed: [null, null, 3, 5, 4, 6], season: null, coverage: 0.8, asked: stepsAhead(2) }),
      forecastOf({ observed: [null, null], season: null, coverage: 0.8, asked: stepsAhead(2) }),
      forecastOf({ observed: [], season: 7, coverage: 0.8, asked: stepsAhead(2) }),
    ]).toEqual([
      { refused: 'history_too_short', have: 4 },
      { refused: 'history_too_short', have: 0 },
      { refused: 'history_too_short', have: 0 },
    ]);
  });

  it('refuses where too few truths were observed to backtest, however many periods the history holds', () => {
    expect(forecastOf({ observed: [5, null, null, null], season: null, coverage: 0.8, asked: stepsAhead(1) })).toEqual({
      refused: 'history_too_short',
      have: 4,
    });
  });

  it('refuses a total where the history holds fewer than three past totals at the same phase, or the calendar names fewer', () => {
    const observed = Array.from({ length: 10 }, () => 2);
    const asked: ForecastQuestion['asked'] = {
      kind: 'total',
      periodsToTheEnd: 4,
      periodsSoFar: 3,
      pastTotals: [{ origin: 2, periodsToTheEnd: 4 }],
    };

    expect([
      forecastOf({ observed, season: null, coverage: 0.8, asked: theRestOfTheWeek(observed) }),
      forecastOf({ observed, season: null, coverage: 0.8, asked }),
    ]).toEqual([
      { refused: 'history_too_short', have: 10 },
      { refused: 'history_too_short', have: 10 },
    ]);
  });
});

describe('the unobserved periods inside the history', () => {
  it('carries the last observed value over an unobserved period, and takes misses only where the truth was observed', () => {
    expect(forecastOf({ observed: [4, null, 2, 0, 1, 4], season: null, coverage: 0.5, asked: stepsAhead(1) })).toEqual({
      method: 'persistence',
      coverage: 0.5,
      season: null,
      history: { periods: 6, origins: 5 },
      points: [{ value: 4, low: 2, high: 5.5 }],
    });
  });

  it('answers a step as persistence does where the value a season earlier is unobserved', () => {
    expect(
      forecastOf({ observed: [1, 5, 9, 2, 6, 10, null, 7, 11], season: 3, coverage: 0.8, asked: stepsAhead(3) }),
    ).toEqual({
      method: 'seasonal-naive',
      coverage: 0.8,
      season: 3,
      history: { periods: 9, origins: 4 },
      points: [
        { value: 11, low: 11, high: 12 },
        { value: 7, low: 7, high: 8 },
        { value: 11, low: 11, high: 12 },
      ],
    });
  });

  it('runs a total at the last observed value where the periods so far are unobserved, and leaves out a past total not wholly observed', () => {
    const week = [2, 2, 2, 4, 4, 4, 4];
    const observed = [[2, 2, 2, 4, null, 4, 4], week, week, week, [null, null, null]].flat();

    expect(forecastOf({ observed, season: null, coverage: 0.8, asked: theRestOfTheWeek(observed) })).toEqual({
      method: 'run-rate',
      coverage: 0.8,
      season: null,
      history: { periods: 31, origins: 4 },
      points: [{ value: 16, low: 16, high: 24 }],
    });
  });
});
