import type { FunctionShape, TrainingRows } from '@on.auto/prediction-contract';
import { describe, expect, it } from 'vitest';

import { windowOf } from '../forecasts/fed-windows.ts';
import { linearForecast } from '../forecasts/linear-forecasts.ts';
import { fittedLinear, linearShapeOf } from './linear-fit.ts';

const monday = 20_752;

const daily: FunctionShape = {
  fed: { features: 0, given: 0, horizon: 2, totals: false },
  grain: 'day',
  season: 7,
  accumulates: null,
  holdout: 8,
};

function weekendsOf(level: number, days: number): Float64Array {
  return Float64Array.from({ length: days }, (_, day) => level * (day % 7 >= 5 ? 1.5 : 1) + (day % 3));
}

function fitted(shape: FunctionShape, training: TrainingRows): NonNullable<ReturnType<typeof fittedLinear>> {
  const linear = fittedLinear(shape, training);
  if (linear === undefined) {
    throw new Error('The linear model was not fitted');
  }
  return linear;
}

describe('the shape of a linear model a function is fitted with', () => {
  it('weighs the last three periods and the one a season back, the calendar marks of its grain, over the level of its longest lag', () => {
    expect([
      linearShapeOf({ grain: 'day', season: 7 }),
      linearShapeOf({ grain: 'month', season: 2 }),
      linearShapeOf({ grain: 'week', season: null }),
    ]).toEqual([
      { lags: [1, 2, 3, 7], marks: 'day-of-week', level: 7 },
      { lags: [1, 2, 3], marks: 'month-of-year', level: 3 },
      { lags: [1, 2, 3], marks: 'none', level: 3 },
    ]);
  });
});

describe('a linear model fitted from the training rows', () => {
  it('learns the weekends of a daily series, and calibrates a conformal interval from its residuals at the last origins', () => {
    const smaller = weekendsOf(10, 70);
    const { model, bounds } = fitted(daily, { first: monday, series: [smaller, weekendsOf(50, 70)] });
    const forecast = linearForecast(model, { window: windowOf(smaller), steps: 2, at: monday + 69, bounds });

    expect(model.weights).toHaveLength(11);
    expect([bounds.low.every((low) => low <= 0), bounds.high.every((high) => high >= 0)]).toEqual([true, true]);
    expect(forecast.map(({ value }) => Math.round(value))).toEqual([11, 11]);
  });

  it('fits every sample when the periods before the last holdout are too few for its weights, and skips a series that ends with no level', () => {
    const weekly: FunctionShape = { ...daily, grain: 'week', season: null, fed: { ...daily.fed, horizon: 1 } };
    const zeros = Float64Array.of(1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0);

    const { model, bounds } = fitted(weekly, {
      first: 0,
      series: [Float64Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), zeros],
    });

    expect([model.weights.length, bounds.low.length]).toEqual([4, 1]);
  });

  it('is none when the training rows hold nothing to fit', () => {
    expect(fittedLinear(daily, { first: monday, series: [Float64Array.of(Number.NaN, Number.NaN)] })).toBeUndefined();
  });
});
