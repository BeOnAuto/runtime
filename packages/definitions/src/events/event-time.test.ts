import { describe, expect, it } from 'vitest';

import { instantOf, isTime } from './event-time.ts';

describe('a time in RFC 3339', () => {
  it('is a day that exists and a time of it, with its offset', () => {
    expect(
      ['2026-10-01T08:59:00Z', '2028-02-29t23:59:59.123456789-12:00', '0000-02-29T00:00:00+14:00'].map((time) =>
        isTime(time),
      ),
    ).toEqual([true, true, true]);
    expect(
      ['2026-02-29T08:59:00Z', '2026-10-01T08:59Z', '2026-10-01 08:59:00Z', 'yesterday'].map((time) => isTime(time)),
    ).toEqual([false, false, false, false]);
  });
});

describe('the instant of a time', () => {
  it('is the same however the time is spelled', () => {
    const instants = [
      '2026-10-01T08:59:00Z',
      '2026-10-01t08:59:00z',
      '2026-10-01T08:59:00.000Z',
      '2026-10-01T10:59:00+02:00',
      '2026-09-30T23:59:00.000000000-09:00',
    ].map((time) => instantOf(time));

    expect(new Set(instants).size).toBe(1);
  });

  it('tells apart times a nanosecond apart, and years before a hundred', () => {
    expect(instantOf('2026-10-01T08:59:00.000000001Z')).not.toBe(instantOf('2026-10-01T08:59:00Z'));
    expect(instantOf('0050-01-01T00:00:00Z')).not.toBe(instantOf('1950-01-01T00:00:00Z'));
  });

  it('counts a leap second as the first second of the next day, in any offset', () => {
    expect(instantOf('2016-12-31T23:59:60Z')).toBe(instantOf('2017-01-01T00:00:00Z'));
    expect(instantOf('2016-12-31T23:59:60Z')).toBe(instantOf('2017-01-01T01:59:60+02:00'));
  });

  it('is the text itself for a text that is no time', () => {
    expect(instantOf('yesterday')).toBe('yesterday');
  });
});
