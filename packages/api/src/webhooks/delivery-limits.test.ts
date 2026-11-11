import { describe, expect, it } from 'vitest';

import { limiterOf } from './delivery-limits.ts';

const aMinute = 60_000;

describe('a limit of deliveries in a minute', () => {
  it('takes each key up to its bound, says how many seconds are left of the minute, and takes it again the next minute', () => {
    const limiter = limiterOf(2);
    const start = 10 * aMinute;

    const waits = [
      limiter.secondsToWait('acme/approvals', start),
      limiter.secondsToWait('acme/approvals', start + 1000),
      limiter.secondsToWait('acme/approvals', start + 15_500),
      limiter.secondsToWait('acme/tickets', start + 15_500),
      limiter.secondsToWait('acme/approvals', start + aMinute),
    ];

    expect(waits).toEqual([0, 0, 45, 0, 0]);
  });

  it('keeps at most ten thousand keys, forgetting the one counted longest ago', () => {
    const limiter = limiterOf(1);
    const keys = Array.from({ length: 10_001 }, (_, index) => `org/connection-${index}`);

    keys.forEach((key) => {
      limiter.secondsToWait(key, 0);
    });

    expect(limiter.secondsToWait('org/connection-0', 0)).toBe(0);
    expect(limiter.secondsToWait('org/connection-10000', 0)).toBe(60);
  });
});
