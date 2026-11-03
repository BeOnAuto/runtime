import { describe, expect, it } from 'vitest';

import { rangeWithin, type AskedRange } from './content-parts.ts';

describe('a range asked of a content of 100 bytes', () => {
  it('is held within the content from its first byte to its last, to the end where it is open or runs past it', () => {
    expect([
      rangeWithin({ start: 0, end: 9 }, 100),
      rangeWithin({ start: 90, end: undefined }, 100),
      rangeWithin({ start: 10, end: 1e20 }, 100),
      rangeWithin({ start: 99, end: Number.POSITIVE_INFINITY }, 100),
      rangeWithin({ start: 7, end: 7 }, 100),
    ]).toEqual([
      { start: 0, end: 9 },
      { start: 90, end: 99 },
      { start: 10, end: 99 },
      { start: 99, end: 99 },
      { start: 7, end: 7 },
    ]);
  });

  it('is no part where it starts at or past the end, before the first byte or between two bytes, or ends before it starts or between two bytes', () => {
    const asked: readonly AskedRange[] = [
      { start: 100, end: undefined },
      { start: 1e20, end: undefined },
      { start: -1, end: 9 },
      { start: 1.5, end: 9 },
      { start: Number.NaN, end: 9 },
      { start: 9, end: 2 },
      { start: 0, end: Number.NaN },
      { start: 0, end: 2.5 },
    ];

    expect(asked.filter((range) => rangeWithin(range, 100) !== undefined)).toEqual([]);
  });

  it('is no part of a content of no bytes', () => {
    expect(rangeWithin({ start: 0, end: undefined }, 0)).toBeUndefined();
  });
});
