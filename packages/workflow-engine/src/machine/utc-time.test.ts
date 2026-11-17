import { describe, expect, it } from 'vitest';

import { drawOf } from './seeded-random.ts';
import { dateTimeOf, isoInstantOf } from './utc-time.ts';

const instants = [
  0, 1, 951_782_400_000, 951_868_799_999, 1_790_845_200_123, 4_107_542_400_000, -1, -62_135_596_800_000,
  253_402_300_799_999,
];

describe('an instant in UTC', () => {
  it.each(instants)('reads %d as the host would, without asking the host', (milliseconds) => {
    expect(isoInstantOf(milliseconds)).toBe(new Date(milliseconds).toISOString());
  });

  it('is given to expressions as an ISO 8601 text and an epoch', () => {
    expect(dateTimeOf(1_790_845_200_123)).toEqual({
      iso8601: '2026-10-01T09:00:00.123Z',
      epoch: { seconds: 1_790_845_200, milliseconds: 1_790_845_200_123 },
    });
  });
});

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
