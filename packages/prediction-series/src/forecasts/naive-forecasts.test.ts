import { describe, expect, it } from 'vitest';

import { ninetiethPercentileOfTheNormal as z } from '../intervals/residual-constants.ts';
import { windowOf } from './fed-windows.ts';
import { drift, historicMean, persistence } from './naive-forecasts.ts';

const flat = windowOf(Float64Array.of(5, 5, 5, 5, 5, 5));

const trending = windowOf(Float64Array.of(1, 2, 3, 4, 5, 6));

const unobserved = windowOf(Float64Array.of(Number.NaN, Number.NaN));

function asked(window: ReturnType<typeof windowOf>, steps = 2) {
  return { window, steps, interval: true };
}

describe('persistence, the last value observed', () => {
  it('carries a flat series forward with no width, since it never changed', () => {
    expect(persistence(asked(flat))).toEqual([
      { value: 5, low: 5, high: 5 },
      { value: 5, low: 5, high: 5 },
    ]);
  });

  it('carries a trending series’ last value forward, wider by the square root of each step', () => {
    const [first, second] = persistence(asked(trending));

    expect([first?.value, first?.high, second?.high]).toEqual([6, 6 + z, 6 + z * Math.SQRT2]);
  });

  it('carries the last value observed over a gap, and answers 0 of a series with nothing observed', () => {
    const gapped = windowOf(Float64Array.of(3, Number.NaN, 4, Number.NaN));

    expect([persistence(asked(gapped, 1)), persistence(asked(unobserved, 1))]).toEqual([
      [{ value: 4, low: 4, high: 4 }],
      [{ value: 0, low: 0, high: 0 }],
    ]);
  });

  it('answers no width when its recipe answers no interval', () => {
    expect(persistence({ window: trending, steps: 1, interval: false })).toEqual([{ value: 6, low: 6, high: 6 }]);
  });
});

describe('the mean of the values observed', () => {
  it('answers the mean at every step, its width the spread of the values times the square root of one and one over T', () => {
    const spread = Math.sqrt(17.5 / 6);
    const half = z * spread * Math.sqrt(1 + 1 / 6);

    expect(historicMean(asked(trending))).toEqual([
      { value: 3.5, low: 3.5 - half, high: 3.5 + half },
      { value: 3.5, low: 3.5 - half, high: 3.5 + half },
    ]);
  });

  it('answers 0 of a series with nothing observed', () => {
    expect(historicMean(asked(unobserved, 1))).toEqual([{ value: 0, low: 0, high: 0 }]);
  });
});

describe('the drift, the line from the first value observed to the last', () => {
  it('continues a trending series exactly, with no width when every change is the drift', () => {
    expect(drift(asked(trending))).toEqual([
      { value: 7, low: 7, high: 7 },
      { value: 8, low: 8, high: 8 },
    ]);
  });

  it('widens by the square root of h times one and h over T less one around changes that wander', () => {
    const [first] = drift(asked(windowOf(Float64Array.of(0, 2, 2, 6)), 1));
    const spread = Math.sqrt((0 + 4 + 4) / 3);

    expect(first).toEqual({
      value: 8,
      low: 8 - z * spread * Math.sqrt(1 + 1 / 3),
      high: 8 + z * spread * Math.sqrt(1 + 1 / 3),
    });
  });

  it('answers no width, as the mean does, when its recipe answers no interval', () => {
    expect([
      historicMean({ window: trending, steps: 1, interval: false }),
      drift({ window: windowOf(Float64Array.of(0, 2, 2, 6)), steps: 1, interval: false }),
    ]).toEqual([[{ value: 3.5, low: 3.5, high: 3.5 }], [{ value: 8, low: 8, high: 8 }]]);
  });

  it('counts its steps from the last value observed, and is persistence with one value observed', () => {
    expect([
      drift(asked(windowOf(Float64Array.of(1, 2, 3, Number.NaN)), 1)).map(({ value }) => value),
      drift(asked(windowOf(Float64Array.of(Number.NaN, 4)), 1)),
    ]).toEqual([[5], [{ value: 4, low: 4, high: 4 }]]);
  });
});
