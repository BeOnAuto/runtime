import { describe, expect, it } from 'vitest';

import { stepsAhead, theRestOfTheWeek } from '../testing/forecast-questions.ts';
import { forecastOf, type ForecastQuestion } from './ladder.ts';

const threeWeeksAndThreeDays = [
  [2, 2, 2, 4, 4, 4, 4],
  [3, 3, 3, 5, 5, 5, 5],
  [1, 1, 1, 6, 6, 6, 6],
  [4, 4, 4],
].flat();

describe('the backtest of the steps ahead', () => {
  it('forecasts from every origin whose truth lies within the history and keeps its misses by step ahead', () => {
    expect(
      forecastOf({ observed: [3, 5, 4, 6, 5, 7], season: null, coverage: 0.5, asked: stepsAhead(2) }),
    ).toMatchObject({
      history: { periods: 6, origins: 4 },
      points: [
        { value: 7, low: 6, high: 9 },
        { value: 7, low: 7, high: 8 },
      ],
    });
  });
});

describe('the backtest of a total', () => {
  it('backtests a total as a total, at the origin of each past enclosing period the calendar names, its truth the sum of that period’s own periods to the end', () => {
    expect(
      forecastOf({
        observed: threeWeeksAndThreeDays,
        season: null,
        coverage: 0.5,
        asked: theRestOfTheWeek(threeWeeksAndThreeDays),
      }),
    ).toMatchObject({
      history: { periods: 24, origins: 3 },
      points: [{ value: 16, low: 16, high: 30 }],
    });
  });

  it('backtests a past total over as many periods as remained in its own enclosing period', () => {
    const asked: ForecastQuestion['asked'] = {
      kind: 'total',
      periodsToTheEnd: 2,
      periodsSoFar: 1,
      pastTotals: [
        { origin: 6, periodsToTheEnd: 3 },
        { origin: 3, periodsToTheEnd: 2 },
        { origin: 0, periodsToTheEnd: 2 },
      ],
    };

    expect(forecastOf({ observed: [1, 1, 1, 1, 1, 1, 1, 2, 2, 2], season: null, coverage: 0.5, asked })).toEqual({
      method: 'run-rate',
      coverage: 0.5,
      season: null,
      history: { periods: 10, origins: 3 },
      points: [{ value: 4, low: 4, high: 5.5 }],
    });
  });

  it('leaves out a past enclosing period that began before the first observed period', () => {
    const observed = [[null, 2, 2, 4, 4, 4, 4], threeWeeksAndThreeDays].flat();

    expect(forecastOf({ observed, season: null, coverage: 0.5, asked: theRestOfTheWeek(observed) })).toMatchObject({
      method: 'run-rate',
      history: { periods: 30, origins: 3 },
      points: [{ value: 16, low: 16, high: 30 }],
    });
  });
});
