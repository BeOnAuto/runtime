import { describe, expect, it } from 'vitest';

import { stepsAhead } from '../testing/forecast-questions.ts';
import { forecastOf } from './ladder.ts';

const aStepAhead = stepsAhead(1);

describe('the range at the coverage', () => {
  it('takes the quantiles of the misses halfway outside the coverage on each side, interpolated between order statistics', () => {
    const observed = [30, 36, 26, 28, 38, 36, 30];

    expect([
      forecastOf({ observed, season: null, coverage: 0.8, asked: aStepAhead }),
      forecastOf({ observed, season: null, coverage: 0.5, asked: aStepAhead }),
    ]).toMatchObject([
      { coverage: 0.8, points: [{ value: 30, low: 22, high: 38 }] },
      { coverage: 0.5, points: [{ value: 30, low: 25, high: 35 }] },
    ]);
  });

  it('holds the value within the range where every miss falls on one side of it', () => {
    expect([
      forecastOf({ observed: [10, 9, 8, 7, 6], season: null, coverage: 0.8, asked: aStepAhead }),
      forecastOf({ observed: [6, 7, 8, 9, 10], season: null, coverage: 0.8, asked: aStepAhead }),
    ]).toMatchObject([{ points: [{ value: 6, low: 5, high: 6 }] }, { points: [{ value: 10, low: 10, high: 11 }] }]);
  });

  it('holds the low at 0 where every observed value is non-negative, and lets it fall below where one is negative', () => {
    expect([
      forecastOf({ observed: [10, 2, 8, 1, 9, 1], season: null, coverage: 0.5, asked: aStepAhead }),
      forecastOf({ observed: [10, 2, 8, -1, 9, 1], season: null, coverage: 0.5, asked: aStepAhead }),
    ]).toMatchObject([{ points: [{ value: 1, low: 0, high: 7 }] }, { points: [{ value: 1, low: -7, high: 7 }] }]);
  });
});
