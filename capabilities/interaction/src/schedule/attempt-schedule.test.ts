import { describe, expect, it } from 'vitest';

import { attemptSchedule, nextAttemptAt } from './attempt-schedule.ts';

const minute = 60_000;

describe('the schedule of the attempts of a delivery', () => {
  it('makes five attempts, the others 1, 2, 4 and 8 minutes after the one before', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => nextAttemptAt({ attempt, endedAt: 0 }))).toEqual([
      minute,
      2 * minute,
      4 * minute,
      8 * minute,
      undefined,
    ]);
    expect(attemptSchedule.attempts).toBe(5);
  });

  it('waits longer when a tool server asks it to, within the longest wait of the schedule', () => {
    expect(nextAttemptAt({ attempt: 1, endedAt: 100, retryAfterMs: 30_000 })).toBe(100 + minute);
    expect(nextAttemptAt({ attempt: 1, endedAt: 100, retryAfterMs: 3 * minute })).toBe(100 + 3 * minute);
    expect(nextAttemptAt({ attempt: 2, endedAt: 100, retryAfterMs: 60 * minute })).toBe(100 + 8 * minute);
  });
});
