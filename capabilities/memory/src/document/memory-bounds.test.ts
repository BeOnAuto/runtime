import { describe, expect, it } from 'vitest';

import { expiresAfter, memoryBounds } from './memory-bounds.ts';

const now = Date.parse('2026-10-01T09:00:00.000Z');

describe('the bounds of a memory', () => {
  it('keep a memory 1 to 2,000 characters long, with at most 8 tags, recalled by at most 1,000 characters of words and at most 16,000 characters at once', () => {
    expect(memoryBounds).toMatchObject({
      leastTextCharacters: 1,
      mostTextCharacters: 2000,
      mostTags: 8,
      defaultRecalledCharacters: 4000,
      mostRecalledCharacters: 16_000,
      mostKept: 10_000,
      mostExamined: 2000,
      mostWordsCharacters: 1000,
    });
  });

  it('expire a memory after a duration from one day to ten years, and give no expiry of any other duration', () => {
    expect([
      expiresAfter('P1D', now),
      expiresAfter('P3650D', now),
      expiresAfter('PT23H', now),
      expiresAfter('P3651D', now),
      expiresAfter('P1Y', now),
    ]).toEqual(['2026-10-02T09:00:00.000Z', '2036-09-28T09:00:00.000Z', undefined, undefined, undefined]);
  });
});
