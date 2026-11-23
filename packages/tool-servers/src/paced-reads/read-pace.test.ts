import { describe, expect, it } from 'vitest';

import { cursorOf, limitFloorMsOf, waitBefore, wokenReadAt } from './read-pace.ts';

const second = 1000;

const day = 24 * 60 * 60 * second;

describe('the wait before the next read', () => {
  it.each([
    { baseMs: 60 * second, floorMs: 0, retryAfterMs: null, waits: 60 },
    { baseMs: 5 * second, floorMs: 60 * second, retryAfterMs: null, waits: 60 },
    { baseMs: 60 * second, floorMs: 5 * second, retryAfterMs: 120 * second, waits: 120 },
    { baseMs: 60 * second, floorMs: 5 * second, retryAfterMs: 30 * second, waits: 60 },
    { baseMs: 60 * second, floorMs: 5 * second, retryAfterMs: 2 * day, waits: 3600 },
  ] as const)(
    'is the base wait $baseMs, never under the floor $floorMs, and as long as a Retry-After of $retryAfterMs asks, an hour at most',
    ({ waits, ...next }) => {
      expect(waitBefore(next) / second).toBe(waits);
    },
  );
});

describe('the floor of a read limit', () => {
  it.each([
    { limit: undefined, floorMs: 0 },
    { limit: { quota: 60, windowSeconds: 3600 }, floorMs: 60_000 },
    { limit: { quota: 7, windowSeconds: 10 }, floorMs: 1429 },
  ] as const)('is the window divided by the quota, rounded up: $limit', ({ limit, floorMs }) => {
    expect(limitFloorMsOf(limit)).toBe(floorMs);
  });
});

describe('the read a wake makes due', () => {
  it.each([
    { reads: 1, now: 15, anchor: 0, due: 20 },
    { reads: 1, now: 15, anchor: 20, due: 20 },
    { reads: 3, now: 15, anchor: 0, due: 30 },
    { reads: 3, now: 26, anchor: 0, due: 31 },
    { reads: 3, now: 15, anchor: 10, due: 25 },
  ] as const)(
    'comes at the end of the window of $reads floors from $anchor, never within a floor of the wake at $now',
    ({ reads, now, anchor, due }) => {
      expect(wokenReadAt({ now: now * second, floorMs: 5 * second, reads, anchor: anchor * second }) / second).toBe(
        due,
      );
    },
  );
});

describe('the cursor a read moves to', () => {
  it.each([
    { order: 'oldest_first', cursors: ['a', 'b'], prior: null, moved: 'b' },
    { order: 'newest_first', cursors: ['b', 'a'], prior: null, moved: 'b' },
    { order: 'oldest_first', cursors: [], prior: 'z', moved: 'z' },
    { order: 'newest_first', cursors: [], prior: null, moved: null },
  ] as const)('is the newest it listed, or where it stood: $order $cursors', ({ order, cursors, prior, moved }) => {
    expect(cursorOf(order, cursors, prior)).toBe(moved);
  });
});
