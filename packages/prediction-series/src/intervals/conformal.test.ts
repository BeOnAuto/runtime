import { describe, expect, it } from 'vitest';

import { conformalBounds, quantileOf } from './conformal.ts';

describe('a conformal interval', () => {
  it('is the 10th and 90th percentiles of the residuals at each step, between which the residuals fall eight times in ten', () => {
    const residuals = Array.from({ length: 11 }, (_, at) => at - 5);

    expect(conformalBounds([residuals, residuals.map((residual) => residual * 2)])).toEqual({
      low: [-4, -8],
      high: [4, 8],
    });
  });

  it('holds the forecast itself, a bound on the forecast’s side of every residual moved to it', () => {
    expect(
      conformalBounds([
        [1, 2, 3],
        [-3, -2, -1],
      ]),
    ).toEqual({ low: [0, -2.8], high: [2.8, 0] });
  });

  it('takes the bounds of the step before at a step with no residual, and none at the first', () => {
    expect(conformalBounds([[], [-1, 1], []])).toEqual({ low: [0, -0.8, -0.8], high: [0, 0.8, 0.8] });
  });
});

describe('a percentile of residuals', () => {
  it('interpolates between the two residuals around its place, and is none of no residual', () => {
    expect([quantileOf([0, 10], 0.25), quantileOf([3], 0.9), quantileOf([], 0.1)]).toEqual([2.5, 3, undefined]);
  });
});
