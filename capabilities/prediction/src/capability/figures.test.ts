import { describe, expect, it } from 'vitest';

import { decimalsObserved, figure, observedFigure } from './figures.ts';

describe('the decimals of the values a function observed', () => {
  it('are the most any finite value carries, at most two, and none for whole numbers or for no value at all', () => {
    expect([
      decimalsObserved(Float64Array.of(130, 131, Number.NaN, 132)),
      decimalsObserved([12.5, 10]),
      decimalsObserved([12.25, Number.NaN, 3]),
      decimalsObserved([0.1 + 0.2, 1.125]),
      decimalsObserved([Number.NaN]),
      decimalsObserved([]),
    ]).toEqual([0, 1, 2, 2, 0, 0]);
  });
});

describe('a figure in words', () => {
  it('carries the decimals observed and no more, and never more than two', () => {
    expect([
      observedFigure(129.932037, 0),
      observedFigure(132.067963, 0),
      observedFigure(12.3456, 1),
      observedFigure(1250.006, 2),
      observedFigure(19.932041, 5),
      observedFigure(120.5, 2),
    ]).toEqual(['130', '132', '12.3', '1,250.01', '19.93', '120.5']);
  });

  it('writes a count with every decimal it has', () => {
    expect(figure(1234.5678)).toBe('1,234.5678');
  });
});
