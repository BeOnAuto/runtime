import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { openedData } from '../assessments/opening.ts';
import type { GoalRule } from '../goal-rules/goal-rule.ts';
import { clockWorkAt, nextWindowOpeningOf, type ClockMoment } from './goal-clock.ts';

const day = (offset: number, hour = 0) => Date.UTC(2026, 10, 9 + offset, hour);

const daily: GoalRule = {
  id: 'daily-check',
  window: { calendar: 'day' },
  success: { settles: 'at_close', target: { at_most: 0 } },
  notify: { passed: 'now', failed: 'now', overdue: 'now' },
};

const moment = (parts: Partial<ClockMoment>): ClockMoment => ({
  goal: daily,
  goalsVersion: 3,
  now: day(0, 0),
  firstSavedAt: day(-1, 12),
  reporting: true,
  playbookRetired: false,
  ...parts,
});

describe('the next window a goal clock opens', () => {
  it('is the first boundary at or after the first save, then the one after the latest opened', () => {
    expect([
      nextWindowOpeningOf(daily, { firstSavedAt: day(0, 12) }),
      nextWindowOpeningOf(daily, { firstSavedAt: day(0) }),
      nextWindowOpeningOf(daily, { firstSavedAt: day(-5), latestOpened: day(2) }),
    ]).toEqual([day(1), day(0), day(3)]);
  });

  it('is none for a goal with no calendar window, no goal or a retired one', () => {
    const { window: _, ...whole } = daily;

    expect([
      nextWindowOpeningOf(whole, { firstSavedAt: 0 }),
      nextWindowOpeningOf({ ...daily, window: { after: 'live', for: 'P1D' } }, { firstSavedAt: 0 }),
      nextWindowOpeningOf(undefined, { firstSavedAt: 0 }),
      nextWindowOpeningOf({ ...daily, retired: true }, { firstSavedAt: 0 }),
    ]).toEqual([null, null, null, null]);
  });
});

describe('the work of a goal clock at a moment', () => {
  it('opens the current window from the present moment, and moves on to its close', () => {
    const work = clockWorkAt(moment({ now: day(3, 7) }));

    expect(work).toEqual({
      open: {
        assessment: assessmentIdOf({ goal: 'daily-check', window_start: day(3) }),
        opens: day(3),
        opened: openedData(daily, 3, { window: { opens: day(3), closes: day(4), due: day(4, 1) } }),
      },
      nextAt: day(4),
    });
  });

  it('opens nothing it opened already and moves on, and holds no boundary while nothing reports the measure', () => {
    expect(clockWorkAt(moment({ latestOpened: day(0) }))).toEqual({ nextAt: day(1) });
    expect(clockWorkAt(moment({ reporting: false }))).toEqual({ nextAt: null });
  });
});

describe('the clock of a daily goal judged on weekdays', () => {
  const weekdays: GoalRule = {
    ...daily,
    window: { calendar: 'day', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
  };

  it('opens a Friday and moves on to Monday, past the days it does not judge', () => {
    const work = clockWorkAt(moment({ goal: weekdays, now: day(4, 7) }));

    expect([work.open?.opens, work.nextAt]).toEqual([day(4), day(7)]);
  });

  it('opens nothing on a Saturday and waits for Monday', () => {
    expect([
      clockWorkAt(moment({ goal: weekdays, now: day(5, 7) })),
      clockWorkAt(moment({ goal: weekdays, now: day(6, 23) })),
    ]).toEqual([{ nextAt: day(7) }, { nextAt: day(7) }]);
  });

  it('names Monday as the next window after a Friday, and after a first save on a Saturday', () => {
    expect([
      nextWindowOpeningOf(weekdays, { firstSavedAt: day(-5), latestOpened: day(4) }),
      nextWindowOpeningOf(weekdays, { firstSavedAt: day(5, 12) }),
      nextWindowOpeningOf(weekdays, { firstSavedAt: day(6) }),
      nextWindowOpeningOf(weekdays, { firstSavedAt: day(2) }),
    ]).toEqual([day(7), day(7), day(7), day(2)]);
  });
});
