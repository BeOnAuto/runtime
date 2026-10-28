import { describe, expect, it } from 'vitest';

import { normalEquations } from './linear-system.ts';

describe('the normal equations of a regularised linear model', () => {
  it('solve for the weights that fit the samples added, the first weight the intercept, which no penalty shrinks', () => {
    const equations = normalEquations(2);
    for (const x of [0, 1, 2, 3]) {
      equations.add([1, x], 1 + 2 * x);
    }

    expect(equations.solved(0)?.map((weight) => Number(weight.toFixed(9)))).toEqual([1, 2]);
  });

  it('shrink every weight but the intercept as the penalty grows', () => {
    const equations = normalEquations(2);
    for (const x of [0, 1, 2, 3]) {
      equations.add([1, x], 1 + 2 * x);
    }
    const slope = equations.solved(10)?.[1];

    expect(Number(slope)).toBeLessThan(2);
  });

  it('have no solution when a feature never varies and nothing penalises it', () => {
    const equations = normalEquations(2);
    equations.add([1, 0], 1);
    equations.add([1, 0], 2);

    expect(equations.solved(0)).toBeUndefined();
  });
});
