import { describe, expect, it } from 'vitest';

import { scoringPermits } from './scoring-permits.ts';

describe('the permits of the walks that score', () => {
  it('are taken up to their number, none past it, and given back once each', () => {
    const permits = scoringPermits(2);
    const first = permits.take();
    const second = permits.take();
    const third = permits.take();
    first?.();
    first?.();

    expect([third, permits.taken()]).toEqual([null, 1]);
    second?.();
    expect(permits.taken()).toBe(0);
  });
});
