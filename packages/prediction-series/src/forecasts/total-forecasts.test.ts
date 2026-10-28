import { describe, expect, it } from 'vitest';

import { ninetiethPercentileOfTheNormal as z } from '../intervals/residual-constants.ts';
import { windowOf } from './fed-windows.ts';
import { levelAdjustedTotal, runRate, seasonalTotal } from './total-forecasts.ts';

const accumulating = windowOf(Float64Array.of(10, 10, 10, 10, 12, 8, 10));

const seasonal = windowOf(Float64Array.of(1, 2, 3, 1, 2, 3, 1, 2, 3));

const growing = windowOf(Float64Array.of(1, 2, 3, 2, 4, 6, 4, 8, 12));

const doubling = windowOf(Float64Array.from({ length: 15 }, (_, at) => 2 ** Math.floor(at / 3) * ((at % 3) + 1)));

const flat = windowOf(new Float64Array(15).fill(5));

describe('the run-rate of a series that accumulates', () => {
  it('is the mean of the enclosing period so far times the periods left, its width the drift’s of the running total', () => {
    const spread = Math.sqrt(8 / 4);
    const half = z * spread * Math.sqrt(4 * (1 + 4 / 3));

    expect(runRate({ window: accumulating, periods: 4, soFar: 3, interval: true })).toEqual({
      value: 40,
      low: 40 - half,
      high: 40 + half,
    });
  });

  it('takes the rate of the last periods as many as are left when the enclosing period has just begun', () => {
    expect(runRate({ window: accumulating, periods: 2, soFar: 0, interval: false })).toEqual({
      value: 18,
      low: 18,
      high: 18,
    });
  });

  it('is 0 when nothing was observed over the periods its rate reads', () => {
    expect(runRate({ window: windowOf(Float64Array.of(4, Number.NaN)), periods: 3, soFar: 1, interval: true })).toEqual(
      { value: 0, low: 0, high: 0 },
    );
  });
});

describe('the seasonal naive of a total', () => {
  it('sums the same periods a season earlier, and is the run-rate until the series holds a season and the periods summed', () => {
    expect([
      seasonalTotal({ window: seasonal, periods: 2, soFar: 0, interval: true, season: 3 }),
      seasonalTotal({ window: windowOf(Float64Array.of(2, 4)), periods: 2, soFar: 0, interval: false, season: 3 }),
    ]).toEqual([
      { value: 3, low: 3, high: 3 },
      { value: 6, low: 6, high: 6 },
    ]);
  });
});

describe('the level-adjusted seasonal naive of a total', () => {
  it('scales the seasonal sum by the level, and is the seasonal naive of the total under two seasons and the periods summed', () => {
    expect([
      levelAdjustedTotal({ window: growing, periods: 2, soFar: 0, interval: true, season: 3, k: 3 }),
      levelAdjustedTotal({ window: growing, periods: 2, soFar: 0, interval: false, season: 3, k: 3 }),
      levelAdjustedTotal({ window: growing, periods: 4, soFar: 0, interval: false, season: 3, k: 3 }),
    ]).toEqual([
      { value: 24, low: 24, high: 24 },
      { value: 24, low: 24, high: 24 },
      { value: 16, low: 16, high: 16 },
    ]);
  });
});

describe('the level-adjusted seasonal naive of a total past a season', () => {
  it('sums each period as many seasons back as it reaches, scaled by the level that many times over', () => {
    const asked = { periods: 6, soFar: 0, interval: false, season: 3, k: 3 };

    expect([
      levelAdjustedTotal({ ...asked, window: doubling }).value,
      levelAdjustedTotal({ ...asked, window: flat }).value,
    ]).toEqual([32 + 64 + 96 + 64 + 128 + 192, 30]);
  });
});
