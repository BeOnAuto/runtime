import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { goalNoticesOf } from './goal-notices.ts';
import { assessment, experiments, monday, noticeBookOf, performedAt, startsAnswering } from './notice-samples.ts';
import { mostSeenWaitMs, noticesOwedOf, seenWaitMs } from './notice-starts.ts';
import { noticedPlaybookIn } from './noticed-playbooks.ts';

const minute = 60_000;

async function bookAssessed(told: string) {
  const book = noticeBookOf();
  await book.playbookCreated();
  await book.goalsSaved([experiments]);
  await book.opened();
  await book.assessed('passed', told);
  const seen = startsAnswering(() => 'started');
  const work = noticesOwedOf({ ledger: book.ledger, start: seen.start, playbookOf: noticedPlaybookIn(book.ledger) });
  return { book, work, starts: seen.starts };
}

describe('a verdict told quietly or in a summary', () => {
  it('owes no notice, so nothing is due and nothing starts', async () => {
    const quiet = await bookAssessed('quiet');
    const summary = await bookAssessed('summary');

    expect([await quiet.book.column('notice_due_at'), await summary.book.column('notice_due_at')]).toEqual([
      null,
      null,
    ]);
    expect(await performedAt(quiet.work, monday + mostSeenWaitMs)).toBe(0);
    expect(await Effect.runPromise(summary.work.nextDueAt(0))).toBeNull();
    expect([...quiet.starts, ...summary.starts]).toEqual([]);
  });
});

describe('the due work of notices', () => {
  it('hands out nothing on the lane that calls out', async () => {
    const { work } = await bookAssessed('now');

    expect(await Effect.runPromise(work.due(monday, 10, true))).toEqual([]);
    expect(await Effect.runPromise(work.nextDueAt(0, true))).toBeNull();
  });

  it('moves a row whose other notice is owed later past the present, so the host never spins', async () => {
    const { book, work } = await bookAssessed('now');
    await book.append(`assessments/${assessment}`, 'goal_overdue', {
      since: new Date(monday + 10 * minute).toISOString(),
      told: 'now',
    });
    await performedAt(work, monday);

    expect(await book.column('notice_due_at')).toBe(monday + seenWaitMs);
    expect(await performedAt(work, monday + seenWaitMs - 1)).toBe(0);
  });
});

describe('a row of notices the due work cannot read', () => {
  it('moves a row whose kept state cannot be read, or names no goal, past the present', async () => {
    const book = noticeBookOf();
    await book.playbookCreated();
    const owedState = JSON.stringify({
      marks: [],
      verdict: 'passed',
      sources: [],
      owed: [{ change: 'passed', due: monday, attempt: 0 }],
      started: [],
    });
    const rows = [
      { org: 'acme', playbook: 'sales', key: 'unreadable', row: { state: 'not a state' } },
      { org: 'acme', playbook: 'sales', key: 'unpinned', row: { state: owedState } },
    ];
    const advanced: unknown[] = [];
    const { starts, start } = startsAnswering(() => 'started');
    const work = noticesOwedOf({
      ledger: {
        ...book.ledger,
        readDueRows: () => Effect.succeed(rows),
        advanceRow: (_projection, _address, key, { set }) => Effect.sync(() => advanced.push([key, set])),
      },
      start,
      playbookOf: noticedPlaybookIn(book.ledger),
    });
    await performedAt(work, monday);

    expect(starts).toEqual([]);
    expect(advanced).toEqual([
      ['unreadable', { notice_due_at: null }],
      ['unpinned', { notice_due_at: null }],
    ]);
    expect(await book.factsOf('assessments/unpinned')).toEqual([]);
  });
});

describe('a row of notices that keeps no state', () => {
  it('moves a row that keeps no state past the present, whatever else it holds', async () => {
    const book = noticeBookOf();
    const advanced: unknown[] = [];
    const work = noticesOwedOf({
      ledger: {
        ...book.ledger,
        readDueRows: () => Effect.succeed([{ org: 'acme', playbook: 'sales', key: 'stateless', row: { state: null } }]),
        advanceRow: (_projection, _address, key, advance) => Effect.sync(() => advanced.push([key, advance])),
      },
      start: startsAnswering(() => 'started').start,
      playbookOf: noticedPlaybookIn(book.ledger),
    });
    await performedAt(work, monday);

    expect(advanced).toEqual([
      ['stateless', { set: { notice_due_at: null }, when: [{ column: 'notice_due_at', before: monday + 1 }] }],
    ]);
  });
});

describe('the due work of notices in the engine', () => {
  it('is composed with the consumer that sees its runs start', () => {
    const book = noticeBookOf();
    const { start } = startsAnswering(() => 'started');
    const parts = goalNoticesOf({
      ledger: book.ledger,
      start,
      playbookOf: noticedPlaybookIn(book.ledger),
      now: () => monday,
    });

    expect([
      parts.consumers.map(({ name }) => name),
      parts.dueWork.map(({ name }) => name),
      parts.playbookOperations,
    ]).toEqual([['goal notices seen'], ['the notices of goals owed', 'the summaries of goals due'], []]);
  });
});
