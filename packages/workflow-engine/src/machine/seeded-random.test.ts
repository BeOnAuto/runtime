import { describe, expect, it } from 'vitest';

import { drawOf } from './seeded-random.ts';

describe('a random draw of a run', () => {
  const draws = Array.from({ length: 1000 }, (_draw, index) => drawOf(7, index));

  it('is the same for the same seed and number of draws', () => {
    expect(drawOf(7, 3)).toBe(drawOf(7, 3));
  });

  it('lies between zero and one, and spreads over them', () => {
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...draws)).toBeLessThan(1);
    expect(draws.filter((draw) => draw < 0.5).length).toBeGreaterThan(400);
    expect(draws.filter((draw) => draw < 0.5).length).toBeLessThan(600);
  });

  it('differs from draw to draw and from seed to seed', () => {
    expect(new Set(draws).size).toBe(draws.length);
    expect(drawOf(8, 0)).not.toBe(drawOf(7, 0));
  });
});
