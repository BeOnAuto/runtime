import { describe, expect, it, vi } from 'vitest';

import { wallClockGivenBack, wallClockTaken } from './woken-clock.ts';

const day = 86_400_000;

const hour = 3_600_000;

describe('the wall clock of a goals test', () => {
  it('reads an hour into a day, never earlier than the real clock, while it is taken, and is the real one once given back', () => {
    const real = Date.now();
    const taken = wallClockTaken();
    const owned = vi.isMockFunction(Date.now);
    wallClockGivenBack();

    expect(owned).toBe(true);
    expect(taken).toBeGreaterThanOrEqual(real);
    expect(taken % day).toBeGreaterThanOrEqual(hour);
    expect(taken % day).toBeLessThan(2 * hour);
    expect(vi.isMockFunction(Date.now)).toBe(false);
  });

  it('stays taken until every server that took it gave it back', () => {
    wallClockTaken();
    wallClockTaken();
    wallClockGivenBack();
    const stillOwned = vi.isMockFunction(Date.now);
    wallClockGivenBack();

    expect(stillOwned).toBe(true);
    expect(vi.isMockFunction(Date.now)).toBe(false);
  });

  it('carries on, when taken again, from where it was given back', () => {
    const later = wallClockTaken() + day;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    wallClockGivenBack();
    const takenAgain = wallClockTaken();
    wallClockGivenBack();

    expect(takenAgain).toBeGreaterThanOrEqual(later);
  });
});
