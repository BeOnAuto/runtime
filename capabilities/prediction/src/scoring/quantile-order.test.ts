import { describe, expect, it } from 'vitest';

import { answeredInOrder, answeredWhole } from './quantile-order.ts';

describe('the percentiles a model answers for its steps', () => {
  it('are in order when each low is at most its likely value and each high at least it', () => {
    expect([
      answeredInOrder([1, 2, 3, 4, 4, 4]),
      answeredInOrder([1, 2, 3, 5, 4, 6]),
      answeredInOrder(Float32Array.of(1, 2, 3, 3, 4, 3.5)),
    ]).toEqual([true, false, false]);
  });

  it('are whole when they are in order and every one is finite, which the shadow counts a series by', () => {
    expect([answeredWhole([1, 2, 3]), answeredWhole([1, Number.NaN, 3]), answeredWhole([3, 2, 4])]).toEqual([
      true,
      false,
      false,
    ]);
  });
});
