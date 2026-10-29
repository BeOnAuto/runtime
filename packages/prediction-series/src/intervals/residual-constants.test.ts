import { describe, expect, it } from 'vitest';

import { ninetiethPercentileOfTheNormal, residualConstant, residualHalfWidth } from './residual-constants.ts';

const reach = { h: 1, periods: 1, season: 7 };

describe('the textbook constant of a residual interval', () => {
  it('is the square root of the steps ahead for the naive forecast', () => {
    expect([1, 4, 9].map((h) => residualConstant('naive', { ...reach, h }))).toEqual([1, 2, 3]);
  });

  it('is the square root of one more than the whole seasons before the step for the seasonal naive', () => {
    expect([1, 7, 8, 14, 15].map((h) => residualConstant('seasonal-naive', { ...reach, h }))).toEqual([
      1,
      1,
      Math.SQRT2,
      Math.SQRT2,
      Math.sqrt(3),
    ]);
  });

  it('is the square root of h times one and h over T less one for the drift', () => {
    expect([
      residualConstant('drift', { ...reach, h: 2, periods: 5 }),
      residualConstant('drift', { ...reach, h: 1, periods: 2 }),
    ]).toEqual([Math.sqrt(3), Math.SQRT2]);
  });

  it('is the square root of one and one over T for the mean, whatever the step', () => {
    expect([1, 5].map((h) => residualConstant('mean', { ...reach, h, periods: 4 }))).toEqual([
      Math.sqrt(1.25),
      Math.sqrt(1.25),
    ]);
  });
});

describe('the half width of a residual interval', () => {
  it('is the 90th percentile of the normal times the residuals’ spread times the constant, so the interval holds eight truths in ten', () => {
    expect(residualHalfWidth(2, 'naive', { ...reach, h: 4 })).toBe(ninetiethPercentileOfTheNormal * 4);
    expect(ninetiethPercentileOfTheNormal).toBeCloseTo(1.281_551_565_5, 10);
  });
});
