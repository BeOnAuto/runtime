import { describe, expect, it } from 'vitest';

import { isCalendarDay } from '../index.ts';

describe('a day of the calendar', () => {
  it.each(['2026-10-06', '2024-02-29', '2026-12-31', '0001-01-01'])('is %s', (day) => {
    expect(isCalendarDay(day)).toBe(true);
  });

  it.each(['2026-02-30', '2025-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-1-6', '20261006', ''])(
    'is not %j, which does not name the same day when read back',
    (day) => {
      expect(isCalendarDay(day)).toBe(false);
    },
  );
});
