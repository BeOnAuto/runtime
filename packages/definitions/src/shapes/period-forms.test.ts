import { describe, expect, it } from 'vitest';

import { chronologically, isTime } from './period-forms.ts';

describe('a time', () => {
  it('is any form an at of a series takes: a period of any grain, or an RFC 3339 date and time', () => {
    expect(
      ['2026-10-15', '2026-W42', '2026-10', '2026-Q4', '2026', '2026-10-15T09:30:00+01:00'].every((at) => isTime(at)),
    ).toBe(true);
    expect(['soon', '2026-13', '2026-10-15T09:30'].some((at) => isTime(at))).toBe(false);
  });
});

describe('the order of the times of a series', () => {
  it('follows the grain of the series, and reads a grain it does not know as dates and times', () => {
    expect(['2026-W42', '2026-W03'].toSorted(chronologically('week'))).toEqual(['2026-W03', '2026-W42']);
    expect(chronologically('decade')('2026-10-15T10:00:00+01:00', '2026-10-15T09:30:00Z')).toBeLessThan(0);
  });
});
