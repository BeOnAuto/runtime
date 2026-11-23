import { describe, expect, it } from 'vitest';

import { checkedOldestFirst } from '../testing/checked-apps.ts';
import { anHour, aPost, checking, dueAfter, minute, polledOf, startingNow } from '../testing/checked-loops.ts';
import { roundAt, startedAt } from '../testing/subscription-loops.ts';
import { answeredAsking } from '../testing/subscription-services.ts';
import { checkDueAt, checkedEveryMs, pollingIntervalSecondsOf } from './check-pace.ts';
import { isNewer, mostPagesARound } from './checked-pages.ts';

const byTheHour = { quota: 30, window_seconds: 3600 };

const limitedByTheHour = { ...checkedOldestFirst, read_limit: byTheHour };

interface Due {
  readonly at: number;
  readonly due: number;
}

interface Waiting {
  readonly what: string;
  readonly written: object;
  readonly retryAfterMs: number | null;
  readonly least: number;
}

const waits: readonly Waiting[] = [
  { what: 'the floor of its read limit', written: limitedByTheHour, retryAfterMs: null, least: 2 * minute },
  { what: 'a Retry-After', written: checkedOldestFirst, retryAfterMs: 5 * minute, least: 5 * minute },
  {
    what: 'a Retry-After of a day, an hour at most',
    written: checkedOldestFirst,
    retryAfterMs: 24 * anHour,
    least: anHour,
  },
];

describe('the pace of a check', () => {
  it('ships a base of a minute and ten pages a round', () => {
    expect([checkedEveryMs, mostPagesARound]).toEqual([60_000, 10]);
  });

  it('falls on one second of the minute for each playbook, about a minute after the last check', () => {
    const dues: readonly Due[] = [startedAt, startedAt + 17_000, startedAt + 41_000].map((at) => ({
      at,
      due: dueAfter(at),
    }));
    const beta = { org: 'acme', playbook: 'beta' };
    const elsewhere = checkDueAt({ now: startedAt, playbook: beta }, polledOf(checkedOldestFirst), null);

    expect(new Set(dues.map(({ due }) => due % minute)).size).toBe(1);
    expect(dues.map(({ at, due }) => Math.abs(due - at - minute) <= minute / 2)).toEqual([true, true, true]);
    expect(elsewhere % minute).not.toBe(dueAfter(startedAt) % minute);
  });
});

describe('the wait before the next check', () => {
  it.each(waits)('is at least $what, on its second of the minute', ({ written, retryAfterMs, least }) => {
    const waited = dueAfter(startedAt, written, retryAfterMs) - startedAt;

    expect([waited >= least, waited < least + minute]).toEqual([true, true]);
    expect(dueAfter(startedAt, written, retryAfterMs) % minute).toBe(dueAfter(startedAt) % minute);
  });

  it('reads the next page no sooner than the floor of its read limit, and waits for a Retry-After the service answered', async () => {
    const written = { ...startingNow, read_limit: byTheHour };
    const checked = checking({
      written,
      runtime: { pagesARound: 1 },
      answering: { order: 'oldest_first', pageSize: 1 },
    });
    await roundAt(checked.ports, startedAt);
    checked.app.posted(aPost('p-1', 0.1), aPost('p-2', 0.2));
    const at = dueAfter(startedAt, written);
    const cut = await roundAt(checked.ports, at);
    checked.app.answers(answeredAsking({ posts: [] }, 10 * minute));
    const limited = await roundAt(checked.ports, at + 2 * minute);

    expect([cut, limited]).toEqual([
      { nextDueAt: at + 2 * minute },
      { nextDueAt: dueAfter(at + 2 * minute, written, 10 * minute) },
    ]);
  });

  it('applies no floor of a read limit kept for some clients alone, and says the pace in seconds', () => {
    const forSome = { ...checkedOldestFirst, read_limit: { ...byTheHour, quota: 1, clients: ['auto'] } };

    expect([
      pollingIntervalSecondsOf(polledOf(checkedOldestFirst)),
      pollingIntervalSecondsOf(polledOf(limitedByTheHour)),
      pollingIntervalSecondsOf(polledOf(forSome)),
    ]).toEqual([60, 120, 60]);
  });
});

describe('whether an item is newer than the mark', () => {
  it.each([
    { cursor: 'a', since: '', newer: true },
    { cursor: '12', since: '9', newer: true },
    { cursor: '9', since: '12', newer: false },
    { cursor: '2026-10-07T09:00:01Z', since: '2026-10-07T09:00:00.000Z', newer: true },
    { cursor: '2026-10-07T08:00:00Z', since: '2026-10-07T09:00:00.000Z', newer: false },
    { cursor: 'msg-2', since: 'msg-1', newer: true },
    { cursor: 'msg-1', since: 'msg-1', newer: false },
  ] as const)(
    'is $newer for $cursor after $since: by number, by time, or else by being another',
    ({ cursor, since, newer }) => {
      expect(isNewer(cursor, since)).toBe(newer);
    },
  );
});
