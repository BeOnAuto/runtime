import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { goalSummariesKind } from '../goal-facts/goal-facts.ts';
import {
  experiments,
  experimentsGoal,
  monday,
  noticeBookOf,
  performedAt,
  sales,
  startsAnswering,
} from '../notices/notice-samples.ts';
import { noticesOwedOf } from '../notices/notice-starts.ts';
import { noticedPlaybookIn } from '../notices/noticed-playbooks.ts';
import {
  dayLimitDetail,
  mostNoticesADay,
  noStartsMade,
  noticesStartedOn,
  startReleased,
  startReservedUnderTheLimit,
} from './notice-day-limit.ts';

const hour = 3_600_000;

const anotherGoal = 'goal-of-replies';

async function bookWithStarts(earlier: number, at = monday - hour) {
  const book = noticeBookOf();
  await book.playbookCreated();
  await book.goalsSaved([experiments]);
  await book.appendAt(
    `definition/acme/${anotherGoal}/goals/goal`,
    'goal_created',
    { playbook: 'sales', position: 1, goal: { ...experiments, id: 'replies' } },
    { definitionId: anotherGoal },
  );
  await book.opened();
  await book.assessed('passed', 'now');
  await Promise.all(
    Array.from({ length: earlier }, (_, index) =>
      book.appendAt(
        `definition/acme/${index % 2 === 0 ? experimentsGoal : anotherGoal}/${goalSummariesKind}/summary-${String(index)}`,
        index % 2 === 0 ? 'goal_summary_started' : 'goal_notice_started',
        { due: new Date(at).toISOString(), run: `run-${String(index)}` },
        { at: new Date(at).toISOString(), by: 'playbook:sales' },
      ),
    ),
  );
  const seen = startsAnswering(() => 'started');
  const work = noticesOwedOf({ ledger: book.ledger, start: seen.start, playbookOf: noticedPlaybookIn(book.ledger) });
  return { book, work, starts: seen.starts };
}

describe('the most notices and summaries a playbook sends in a UTC day', () => {
  it('counts the starts seen in the ledger on the day of the moment asked, of every goal the playbook holds, and none on a day with none', async () => {
    const { book } = await bookWithStarts(3);

    expect([
      await Effect.runPromise(noticesStartedOn(book.ledger, sales, monday)),
      await Effect.runPromise(noticesStartedOn(book.ledger, sales, monday + 24 * hour)),
    ]).toEqual([3, 0]);
  });

  it('starts a notice while the day has seen fewer than the most', async () => {
    const { book, work, starts } = await bookWithStarts(mostNoticesADay - 1);
    await performedAt(work, monday);

    expect(starts).toHaveLength(1);
    expect(await book.refusals()).toEqual([]);
  });

  it('refuses the notice past the most for good, saying why, and starts nothing', async () => {
    const { book, work, starts } = await bookWithStarts(mostNoticesADay);
    await performedAt(work, monday);

    expect(starts).toEqual([]);
    expect(await book.refusals()).toEqual([
      {
        change: 'passed',
        attempt: 1,
        detail: dayLimitDetail(sales, monday),
        at: new Date(monday).toISOString(),
      },
    ]);
    expect(dayLimitDetail(sales, monday)).toBe(
      'The playbook sales reached its limit of 200 messages and summaries on 2026-11-09 (UTC)',
    );
    expect(await book.column('notice_due_at')).toBeNull();
  });

  it('starts it again on the next UTC day, since the day before counts nothing', async () => {
    const { work, starts } = await bookWithStarts(mostNoticesADay, monday - 24 * hour);
    await performedAt(work, monday);

    expect(starts).toHaveLength(1);
  });
});

describe('the starts a piece of work made today', () => {
  it('counts a run once, lets a released one go, and keeps no day but the one asked', async () => {
    const { book } = await bookWithStarts(0);
    const starts = noStartsMade();
    const reserved = (run: string, now = monday) =>
      Effect.runPromise(startReservedUnderTheLimit(book.ledger, starts, { address: sales, run, now }));
    startReleased(starts, { address: sales, run: 'never-made', now: monday });
    const made = [await reserved('a'), await reserved('a'), await reserved('b')];
    startReleased(starts, { address: sales, run: 'b', now: monday });

    expect(made).toEqual([true, true, true]);
    expect([...starts.made.values()].map((runs) => Array.from(runs))).toEqual([['a']]);
    await reserved('c', monday + 24 * hour);
    expect([...starts.made.values()].map((runs) => Array.from(runs))).toEqual([['c']]);
  });
});
