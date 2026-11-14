import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { windowEdgesAt, windowOpeningAfter } from './window-times.ts';

const aDay = 86_400_000;

const midnightUtc = Date.UTC(2026, 10, 9);

describe('the edges of a window', () => {
  it('counts a fixed period from its anchor', () => {
    const edges = windowEdgesAt(
      { kind: 'every', milliseconds: aDay },
      { anchor: midnightUtc, due: midnightUtc, now: midnightUtc + 2.5 * aDay },
    );

    expect(edges).toEqual(Result.succeed({ latest: midnightUtc + 2 * aDay, next: midnightUtc + 3 * aDay }));
  });

  it('collapses the boundaries a calendar missed to the latest and names the next', () => {
    const edges = windowEdgesAt(
      { kind: 'cron', expression: '0 0 * * *' },
      { anchor: midnightUtc, due: midnightUtc, now: midnightUtc + 3.5 * aDay },
    );

    expect(edges).toEqual(Result.succeed({ latest: midnightUtc + 3 * aDay, next: midnightUtc + 4 * aDay }));
  });

  it('reads a calendar in its own time zone', () => {
    const newYorkMidnight = Date.UTC(2026, 10, 9, 5);

    const edges = windowEdgesAt(
      { kind: 'cron', expression: '0 0 * * *', time_zone: 'America/New_York' },
      { anchor: midnightUtc, due: midnightUtc, now: newYorkMidnight + 1000 },
    );

    expect(edges).toEqual(Result.succeed({ latest: newYorkMidnight, next: newYorkMidnight + aDay }));
  });

  it('refuses a time zone that is none', () => {
    const edges = windowEdgesAt(
      { kind: 'cron', expression: '0 0 * * *', time_zone: 'Nowhere/Land' },
      { anchor: midnightUtc, due: midnightUtc, now: midnightUtc },
    );

    expect(Result.isFailure(edges)).toBe(true);
  });
});

describe('the opening of the first window', () => {
  it('is one period after the anchor for a fixed period', () => {
    expect(windowOpeningAfter({ kind: 'every', milliseconds: aDay }, midnightUtc)).toEqual(
      Result.succeed(midnightUtc + aDay),
    );
  });

  it('is the next time a calendar names after the moment given', () => {
    expect(windowOpeningAfter({ kind: 'cron', expression: '0 12 * * *' }, midnightUtc, midnightUtc + aDay)).toEqual(
      Result.succeed(midnightUtc + aDay + 12 * 3_600_000),
    );
  });
});
