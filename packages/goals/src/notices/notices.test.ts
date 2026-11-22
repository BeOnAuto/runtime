import { Conflict, type PlaybookAddress } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { goalNoticesOf } from './goal-notices.ts';
import { noticeRecorded } from './notice-ledger.ts';
import {
  assessment,
  experiments,
  experimentsGoal,
  monday,
  noticeBookOf,
  performedAt,
  runOf,
  sales,
  startsAnswering,
  type NoticeBook,
} from './notice-samples.ts';
import { mostSeenWaitMs, noticesOwedOf, seenWaitMs } from './notice-starts.ts';
import { noticedPlaybookIn } from './noticed-playbooks.ts';
import { noticeSeenIn, noticesSeenOf } from './notices-seen.ts';

async function seenTwice() {
  const book = noticeBookOf();
  await book.goalsSaved([experiments]);
  await book.opened();
  await book.assessed('passed', 'now');
  const record = await book.runStarted(runOf('passed'));
  const seen = noticesSeenOf(book.ledger, () => monday);
  const batch = await Effect.runPromise(seen.batchOf({ playbook: sales, record }));
  const delivered = Effect.forEach(batch.deliveries, ({ deliver }) => deliver);
  await Effect.runPromise(Effect.andThen(delivered, delivered));
  await Effect.runPromise(Effect.forEach(batch.deliveries, ({ skipped }) => skipped()));
  return { book, record, seen, batch };
}

describe('the consumer that sees a notice start', () => {
  it('records the start of a notice from its run_started, once however often the record is delivered', async () => {
    const { book, record, batch } = await seenTwice();

    expect([batch.through, batch.more, batch.deliveries.map(({ key, workflow }) => [key, workflow])]).toEqual([
      record.id,
      false,
      [[record.id, 'goal notices seen']],
    ]);
    expect(await book.factsOf(`assessments/${assessment}`)).toEqual([
      'goal_assessment_opened',
      'goal_assessed',
      'goal_notice_started',
    ]);
    expect(await book.column('notice_due_at')).toBeNull();
  });

  it('delivers nothing more for a record it already delivered', async () => {
    const { record, seen } = await seenTwice();
    const again = await Effect.runPromise(seen.batchOf({ playbook: sales, record }, record.id));

    expect([again.deliveries, again.more, 'through' in again]).toEqual([[], false, true]);
    expect(again.through).toBeUndefined();
  });

  it('records nothing for a run of an assessment that never opened', async () => {
    const book = noticeBookOf();
    const record = await book.runStarted(runOf('failed'));
    const seen = noticesSeenOf(book.ledger, () => monday);
    const batch = await Effect.runPromise(seen.batchOf({ playbook: sales, record }));
    await Effect.runPromise(Effect.forEach(batch.deliveries, ({ deliver }) => deliver));

    expect(await book.factsOf(`assessments/${assessment}`)).toEqual([]);
  });

  it('fails the delivery for a retry when the start cannot be recorded now', async () => {
    const book = await savedBook();
    const record = await book.runStarted(runOf('passed'));
    const failing = noticesSeenOf(
      { ...book.ledger, execute: () => Effect.fail(new Conflict({ detail: 'Another append came first' })) },
      () => monday,
    );
    const { deliveries } = await Effect.runPromise(failing.batchOf({ playbook: sales, record }));
    const exits = await Promise.all(deliveries.map(({ deliver }) => Effect.runPromise(Effect.exit(deliver))));

    expect(exits).toMatchObject([
      Exit.fail({ detail: `The start of the notice ${runOf('passed')} could not be recorded now` }),
    ]);
  });
});

async function savedBook(): Promise<NoticeBook> {
  const book = noticeBookOf();
  await book.goalsSaved([experiments]);
  return book;
}

async function assessed(): Promise<NoticeBook> {
  const book = await savedBook();
  await book.opened();
  await book.assessed('passed', 'now');
  return book;
}

async function deliveredIn(book: NoticeBook, playbook: PlaybookAddress): Promise<readonly string[]> {
  const record = await book.runStarted(runOf('passed'));
  const batch = await Effect.runPromise(noticesSeenOf(book.ledger, () => monday).batchOf({ playbook, record }));
  await Effect.runPromise(Effect.forEach(batch.deliveries, ({ deliver }) => deliver));
  return book.factsOf(`assessments/${assessment}`);
}

describe('the consumer that sees a notice start, across a move', () => {
  it('records nothing of a run in a playbook the goal was never in, and the start of a run in the playbook it moved from', async () => {
    const [elsewhere, moved] = [await assessed(), await assessed()];
    const fromSales = { from: 'sales', to: 'marketing', moved_by: { id: 'person:ada', name: 'Ada' }, position: 0 };
    await moved.ofTheGoal('goals/goal', 'goal_reordered', { position: 1 });
    await moved.ofTheGoal('goals/goal', 'goal_moved', fromSales);

    expect([
      await deliveredIn(elsewhere, { org: 'acme', playbook: 'marketing' }),
      await deliveredIn(moved, sales),
    ]).toEqual([
      ['goal_assessment_opened', 'goal_assessed'],
      ['goal_assessment_opened', 'goal_assessed', 'goal_notice_started'],
    ]);
  });
});

describe('what the consumer takes for a notice', () => {
  it('is a goal trigger naming an assessment, on a run whose id is made of it and a change', async () => {
    const book = noticeBookOf();
    const notice = await book.runStarted(runOf('overdue'));
    const other = await book.runStarted('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a');
    const elsewhere = await book.runStarted(runOf('passed'), 'goals/paying-customers/other/thing');
    const cron = {
      ...notice,
      context: { ...notice.context, trigger: { kind: 'cron', reference: '/schedule' } },
    } as const;
    const read = [notice, other, elsewhere, cron, { ...notice, stream: `assessments/${assessment}` }].map((record) =>
      noticeSeenIn(record),
    );

    expect(read.filter((seen) => seen !== undefined)).toEqual([
      { definition: experimentsGoal, assessment, change: 'overdue', run: runOf('overdue') },
    ]);
    expect(read).toHaveLength(5);
  });

  it('wants only a playbook whose goals keep a clock', async () => {
    const book = noticeBookOf();
    const { wants } = noticesSeenOf(book.ledger, () => monday);
    const asked = (key: string) => Effect.runPromise(wants(key));
    const before = await asked('playbook/acme/sales/');
    await book.goalsSaved([experiments]);

    expect([before, await asked('playbook/acme/sales/'), await asked('org/acme/')]).toEqual([false, true, false]);
  });
});

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
    await book.ofTheGoal(`assessments/${assessment}`, 'goal_overdue', {
      since: new Date(monday + 10 * minute).toISOString(),
      told: 'now',
    });
    await performedAt(work, monday);

    expect(await book.column('notice_due_at')).toBe(monday + seenWaitMs);
    expect(await performedAt(work, monday + seenWaitMs - 1)).toBe(0);
  });
});

describe('a row of notices the due work cannot read', () => {
  it('moves a row whose kept state cannot be read past the present, and leaves a row of a goal the playbook does not hold to the playbook that holds it', async () => {
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
      { org: 'acme', playbook: 'sales', definition: experimentsGoal, key: 'unreadable', row: { state: 'not a state' } },
      { org: 'acme', playbook: 'sales', definition: 'goal-held-elsewhere', key: 'unpinned', row: { state: owedState } },
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
    expect(advanced).toEqual([['unreadable', { notice_due_at: null }]]);
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

describe('a refusal of a notice no longer owed', () => {
  it('records nothing, as when the notice started on another host meanwhile', async () => {
    const book = noticeBookOf();
    await book.goalsSaved([experiments]);
    await book.opened();
    await Effect.runPromise(
      noticeRecorded(book.ledger, { org: sales.org, definition: experimentsGoal }, assessment, {
        kind: 'refused',
        change: 'passed',
        attempt: 1,
        detail: 'The function tell-owner could not be started now',
        at: new Date(monday).toISOString(),
        by: 'playbook:sales',
      }),
    );

    expect(await book.factsOf(`assessments/${assessment}`)).toEqual(['goal_assessment_opened']);
  });
});
