import { describe, expect, it } from 'vitest';

import { ninetiethPercentileOfTheNormal as z } from '../intervals/residual-constants.ts';
import { windowOf, type FedWindow } from './fed-windows.ts';
import { levelAdjustedSeasonalNaive, seasonalNaive } from './seasonal-forecasts.ts';

const twoSeasons = windowOf(Float64Array.of(1, 2, 3, 1, 2, 3));

const growing = windowOf(Float64Array.of(1, 2, 3, 2, 4, 6, 4, 8, 12));

const doubling = windowOf(Float64Array.from({ length: 15 }, (_, at) => 2 ** Math.floor(at / 3) * ((at % 3) + 1)));

const flat = windowOf(new Float64Array(15).fill(5));

function values(points: readonly { readonly value: number }[]): readonly number[] {
  return points.map(({ value }) => value);
}

function asked(window: FedWindow, steps: number) {
  return { window, steps, interval: true, season: 3, k: 3 };
}

describe('the seasonal naive, the value a season earlier', () => {
  it('repeats a seasonal series of two seasons, with no width when every season is the same', () => {
    expect(seasonalNaive(asked(twoSeasons, 3))).toEqual([
      { value: 1, low: 1, high: 1 },
      { value: 2, low: 2, high: 2 },
      { value: 3, low: 3, high: 3 },
    ]);
  });

  it('takes the value as many whole seasons earlier as a step past the season needs, wider by the seasons it spans', () => {
    const noisy = windowOf(Float64Array.of(1, 2, 3, 2, 2, 3, 2, 3, 3));
    const spread = Math.sqrt((1 + 0 + 0 + 0 + 1 + 0) / 6);
    const points = seasonalNaive(asked(noisy, 4));

    const widths = points.map(({ value, high }) => (high - value) / (z * spread));

    expect(values(points)).toEqual([2, 3, 3, 2]);
    expect(widths.map((width) => Number(width.toFixed(12)))).toEqual([1, 1, 1, Number(Math.SQRT2.toFixed(12))]);
  });

  it('is persistence until the series holds a season and the steps asked', () => {
    expect(values(seasonalNaive(asked(windowOf(Float64Array.of(1, 2, 3, 4)), 2)))).toEqual([4, 4]);
  });
});

describe('the level-adjusted seasonal naive', () => {
  it('is the value a season earlier times the mean of the last k periods over the mean of the same k a season earlier', () => {
    expect(levelAdjustedSeasonalNaive(asked(growing, 2))).toEqual([
      { value: 8, low: 8, high: 8 },
      { value: 16, low: 16, high: 16 },
    ]);
  });

  it('is the seasonal naive while the series holds less than two seasons and the steps asked, and persistence before a season', () => {
    expect([
      values(levelAdjustedSeasonalNaive(asked(growing, 4))),
      values(levelAdjustedSeasonalNaive(asked(twoSeasons, 1))),
      values(levelAdjustedSeasonalNaive(asked(windowOf(Float64Array.of(2, 4)), 1))),
    ]).toEqual([[4, 8, 12, 4], [1], [4]]);
  });

  it('reads over the periods not observed, its level from those that were, the value before a gap where a season earlier was not observed', () => {
    const gapped = windowOf(Float64Array.of(1, 2, 3, Number.NaN, Number.NaN, Number.NaN, 4, 8, 12, Number.NaN, 6, 7));
    const [level] = levelAdjustedSeasonalNaive(asked(gapped, 1));
    const [seasonal] = seasonalNaive(asked(gapped, 1));

    expect([level?.value, seasonal?.value]).toEqual([12 * (6.5 / 8), 12]);
    expect([Number(level?.high) > Number(level?.value), Number(seasonal?.high) > Number(seasonal?.value)]).toEqual([
      true,
      true,
    ]);
  });

  it('answers no width when its recipe answers no interval, and leaves the level alone where the level would turn the sign', () => {
    const turning = windowOf(Float64Array.of(1, 1, 1, 1, 1, 1, -1, -1, -1));
    const plain = { ...asked(turning, 1), interval: false };

    expect([levelAdjustedSeasonalNaive(plain), seasonalNaive(plain)]).toEqual([
      [{ value: -1, low: -1, high: -1 }],
      [{ value: -1, low: -1, high: -1 }],
    ]);
  });

  it('leaves the level alone when the season before held nothing but zeros, and widens with the errors of its own forecasts', () => {
    const fromNothing = windowOf(Float64Array.of(1, 1, 1, 0, 0, 0, 2, 4, 6));
    const [first] = levelAdjustedSeasonalNaive(asked(fromNothing, 1));

    expect(first?.value).toBe(2);
    expect(Number(first?.high) - Number(first?.value)).toBeGreaterThan(0);
  });
});

describe('the level-adjusted seasonal naive past a season', () => {
  it('scales a step as many seasons back as it reaches by the level that many times over, so a series that doubles each season goes on doubling', () => {
    const plain = { ...asked(doubling, 6), interval: false };

    expect(values(levelAdjustedSeasonalNaive(plain))).toEqual([32, 64, 96, 64, 128, 192]);
  });

  it('carries a flat series forward unchanged however many seasons its steps reach', () => {
    expect(values(levelAdjustedSeasonalNaive(asked(flat, 7)))).toEqual([5, 5, 5, 5, 5, 5, 5]);
  });

  it('leaves the level alone where it would take a forecast past the largest number', () => {
    const soaring = windowOf(Float64Array.of(1, 1, 1, 1, 1, 1, 1, 1, 1, 1e160, 1e160, 1e160));
    const plain = { ...asked(soaring, 4), interval: false };

    expect(values(levelAdjustedSeasonalNaive(plain))).toEqual([1e160, 1e160, 1e160, 1e160]);
  });
});
