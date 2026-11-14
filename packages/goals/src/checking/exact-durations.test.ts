import { describe, expect, it } from 'vitest';

import { exactDurationOf } from '../index.ts';

const aMinute = 60_000;

describe('an exact duration', () => {
  it.each([
    ['PT1M', aMinute],
    ['PT12H', 12 * 60 * aMinute],
    ['P1D', 24 * 60 * aMinute],
    ['P2W', 14 * 24 * 60 * aMinute],
    ['P1W2DT3H4M', ((9 * 24 + 3) * 60 + 4) * aMinute],
  ])('reads %s in weeks, days, hours and minutes', (text, milliseconds) => {
    expect(exactDurationOf(text)).toBe(milliseconds);
  });

  it.each(['P', 'PT', 'P1DT', 'P1M', 'P1Y', 'PT30S', 'P1.5D', 'p1d', '1D', 'P-1D', ' P1D'])(
    'is not %j, which has no fixed length or is not written as one',
    (text) => {
      expect(exactDurationOf(text)).toBeUndefined();
    },
  );
});
