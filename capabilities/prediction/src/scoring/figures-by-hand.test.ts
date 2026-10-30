import { describe, expect, it } from 'vitest';

import type { Predicts } from '../document/prediction-document.ts';
import { baselineForecast, scaleOf } from './baselines.ts';
import { blockLengthOf, pBetterOf, seedOf } from './bootstrap.ts';
import { originDifferences, primaryOf, scoredOf } from './metrics.ts';
import { scoringGridOf } from './scoring-grid.ts';

const daily: Predicts = { target: 'visits', period: 'day', horizons: [1, 2], unit: 'visits', history: 4 };

const grid = scoringGridOf(daily, { window: 12, holdout: 4, firstPeriod: '2026-10-01' });

const values = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 10, 9, 12, 11]);

function lastValueForecast(): Float64Array {
  const origins = [10, 9, 12, 11];
  return Float64Array.from(origins.flatMap((last) => [last - 1, last, last + 1, last - 1, last, last + 1]));
}

const candidate = { values, forecast: lastValueForecast(), scale: scaleOf(grid, values) };

describe('the figures of a candidate on a small series, computed by hand', () => {
  it('scale its error by the in-sample error of the naive forecast, one period to the next, over the training periods', () => {
    expect(scaleOf(grid, values)).toBe(1);
  });

  it('count the pairs of each horizon within the holdout, and give mase, winkler at 0.2 and the quantile score of each', () => {
    expect(scoredOf(grid, [candidate])).toEqual({
      scores: [
        { horizon: 1, pairs: 3, mase: 1.666_67, winkler: 8.666_67, quantile: 1.7 },
        { horizon: 2, pairs: 2, mase: 2, winkler: 12, quantile: 2.2 },
      ],
      coverage: 0.4,
      seriesWalked: 1,
    });
  });

  it('take as the primary figure the mean of the metric over the horizons', () => {
    const { scores } = scoredOf(grid, [candidate]);

    expect(primaryOf(scores, 'mase')).toBeCloseTo((1.666_67 + 2) / 2, 12);
    expect(primaryOf(scores, 'winkler')).toBeCloseTo((8.666_67 + 12) / 2, 12);
    expect(primaryOf(scores, 'quantile')).toBeCloseTo((1.7 + 2.2) / 2, 12);
  });
});

describe('the baselines on a small series, computed by hand', () => {
  it('carry the last value forward for persistence, its interval the quantiles of its own in-sample errors', () => {
    const forecast = baselineForecast(grid, values, 'persistence');

    expect([...forecast.subarray(0, 6)]).toEqual([11, 10, 11, 12, 10, 12]);
    expect(scoredOf(grid, [{ values, forecast, scale: 1 }]).scores).toEqual([
      { horizon: 1, pairs: 3, mase: 1.666_67, winkler: 20, quantile: 2.833_33 },
      { horizon: 2, pairs: 2, mase: 2, winkler: 0, quantile: 1 },
    ]);
  });

  it('take the value one season earlier for seasonal-naive, and skip a series at an origin before a season is observed', () => {
    const seasonal = scoringGridOf({ ...daily, season: 4 }, { window: 12, holdout: 4, firstPeriod: '2026-10-01' });
    const late = Float64Array.from([...Array.from({ length: 7 }, () => Number.NaN), 1, 2, 3, 4, 5]);

    expect([...baselineForecast(seasonal, values, 'seasonal-naive').subarray(0, 6)]).toEqual([10, 6, 10, 11, 7, 11]);
    expect([...baselineForecast(seasonal, late, 'seasonal-naive')].slice(0, 15)).toEqual([
      ...Array.from({ length: 12 }, () => Number.NaN),
      1,
      1,
      1,
    ]);
  });
});

const toTheWeek: Predicts = {
  target: 'sales',
  period: 'day',
  season: 7,
  horizons: [],
  accumulates: 'week',
  unit: 'sales',
  history: 14,
};

const weeks = scoringGridOf(toTheWeek, { window: 21, holdout: 7, firstPeriod: '2026-10-05' });

const sales = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 2, 2, 2, 2, 2, 2, 2]);

describe('the baselines of a total to the end of the week on a small series, computed by hand', () => {
  it('scale the error by the mean absolute error of the run-rate over the training periods', () => {
    expect(scaleOf(weeks, sales)).toBe(147 / 13);
  });

  it('take as persistence the run-rate, the mean of the week so far times the days left, its interval scaled by the days left', () => {
    const forecast = baselineForecast(weeks, sales, 'persistence');

    expect([...forecast.subarray(0, 6)]).toEqual([-9, 12, 33, -7.5, 10, 27.5]);
    expect(scoredOf(weeks, [{ values: sales, forecast, scale: scaleOf(weeks, sales) }])).toEqual({
      scores: [{ horizon: null, pairs: 6, mase: 0, winkler: 24.5, quantile: 2.45 }],
      coverage: 1,
      seriesWalked: 1,
    });
  });

  it('take as seasonal-naive the sum of the same days one season earlier', () => {
    expect(baselineForecast(weeks, sales, 'seasonal-naive')[1]).toBe(21);
  });
});

describe('the moving-block bootstrap of the difference by origin', () => {
  it('differs per origin over the pairs both forecasts have, the candidate less the baseline', () => {
    const persistence = { values, forecast: baselineForecast(grid, values, 'persistence'), scale: 1 };

    expect(originDifferences(grid, [{ candidate, baseline: persistence }], 'winkler')).toEqual([-3, 7, -18]);
    expect(originDifferences(grid, [{ candidate, baseline: persistence }], 'mase')).toEqual([0, 0, 0]);
  });

  it('takes blocks of a season when three fit the origins, or else of the cube root of the origins rounded up, at least one', () => {
    expect([
      blockLengthOf(undefined, 8),
      blockLengthOf(undefined, 9),
      blockLengthOf(7, 21),
      blockLengthOf(7, 20),
      blockLengthOf(52, 11),
      blockLengthOf(undefined, 0),
    ]).toEqual([2, 3, 7, 3, 3, 1]);
  });

  it('is sure the candidate is better when every difference is below zero, and never when none is', () => {
    const seed = seedOf('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a');

    expect([
      pBetterOf([-3, -7, -18], undefined, seed),
      pBetterOf([0, 0, 0], undefined, seed),
      pBetterOf([], 1, seed),
    ]).toEqual([1, 0, 0]);
  });

  it('resamples the whole series when a block holds it, and draws each origin alone with blocks of one', () => {
    const seed = seedOf('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a');

    expect(pBetterOf([-3, 1], undefined, seed)).toBe(1);
    expect(pBetterOf([-3, 1, 1, 1, 1, 1], 1, seed)).toBeCloseTo(0.26, 1);
    expect(pBetterOf([-3, 1, 1, 1, 1, 1], 1, seed)).toBe(
      pBetterOf([-3, 1, 1, 1, 1, 1], 1, seedOf('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a')),
    );
  });
});
