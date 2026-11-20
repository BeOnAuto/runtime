import type { Goal } from '@on.auto/definitions/goals';
import { describe, expect, it } from 'vitest';

import { noticeGapsIn } from '../notices/notice-gaps.ts';
import { assessment, experiments, monday, noticeBookOf, runOf, type NoticeBook } from '../notices/notice-samples.ts';
import { heldGoalOf } from '../reads/assessment-samples.ts';
import { newestNoticeOf, noticesDeliveredIn, noticeUndeliveredGap } from './notice-deliveries.ts';

const anyWords: unknown = expect.any(String);

const minute = 60_000;

const experimentsGoal: Goal = {
  id: experiments.id,
  statement: experiments.statement,
  per: 'experiment',
  success: {
    label: 'New paying customers',
    settles: 'on_crossing',
    target: { at_least: 1 },
    passed: 'Brought a customer',
    failed: 'Brought no customer',
  },
  notify: { passed: 'now', failed: 'now', through: 'tell-owner' },
};

async function startedBook(): Promise<NoticeBook> {
  const book = noticeBookOf();
  await book.playbookCreated();
  await book.goalsSaved([experiments]);
  await book.opened();
  return book;
}

async function noticeStarted(book: NoticeBook, change: 'passed' | 'failed' | 'overdue', at: number): Promise<void> {
  await book.ofTheGoal(
    `assessments/${assessment}`,
    'goal_notice_started',
    { change, run: runOf(change) },
    { at: new Date(at).toISOString(), by: 'playbook:sales' },
  );
}

const rejection = {
  rejection: { reason: 'unanswered', kind: 'expired', detail: 'The request expired before it was delivered' },
};

describe('whether a started notice was delivered, read from its own run', () => {
  it('is true once its run succeeded, false once it was rejected or failed, and absent while it goes on', async () => {
    const book = await startedBook();
    await book.append(`runs/${runOf('passed')}`, 'run_started', { input: {} });
    await book.append(`runs/${runOf('passed')}`, 'run_succeeded', { output: null, record: {} });
    await book.append(`runs/${runOf('failed')}`, 'run_rejected', rejection);
    await book.append(`runs/${runOf('overdue')}`, 'run_failed', {});
    const at = new Date(monday).toISOString();
    const notices = (['passed', 'failed', 'overdue'] as const).map((change) => ({ change, at, run: runOf(change) }));
    const going = { change: 'passed' as const, at, run: 'a-run-still-going' };

    expect(await book.inThePlaybook(noticesDeliveredIn([...notices, going]))).toEqual([
      { ...notices[0], delivered: true },
      { ...notices[1], delivered: false },
      { ...notices[2], delivered: false },
      going,
    ]);
  });
});

describe('the gap of a notice that was not delivered', () => {
  it('shows when the newest started notice of the goal ended unanswered, with how it ended', async () => {
    const book = await startedBook();
    await noticeStarted(book, 'passed', monday);
    await book.append(`runs/${runOf('passed')}`, 'run_rejected', rejection);

    expect(await book.inThePlaybook(noticeGapsIn([heldGoalOf(experimentsGoal)]))).toEqual([
      {
        kind: 'notice_undelivered',
        goal: experiments.id,
        detail: anyWords,
        fixed_by: 'agent',
      },
    ]);
  });
});

describe('the words of the gap of a notice that was not delivered', () => {
  it('says a failed run, and a rejection it cannot read, in its own words', async () => {
    const book = await startedBook();
    await noticeStarted(book, 'overdue', monday);
    await book.append(`runs/${runOf('overdue')}`, 'run_failed', {});
    const other = await startedBook();
    await noticeStarted(other, 'failed', monday);
    await other.append(`runs/${runOf('failed')}`, 'run_rejected', {});

    const [failed] = await book.inThePlaybook(noticeGapsIn([heldGoalOf(experimentsGoal)]));
    const [rejected] = await other.inThePlaybook(noticeGapsIn([heldGoalOf(experimentsGoal)]));

    expect([failed?.detail, rejected?.detail]).toEqual([
      'The message saying the goal paying-customers became overdue was not delivered: its run failed. Check the connection, the address and the expiry of tell-owner (an hour at least).',
      'The message saying the goal paying-customers failed was not delivered: its run was rejected. Check the connection, the address and the expiry of tell-owner (an hour at least).',
    ]);
  });
});

describe('a notice that leaves no gap', () => {
  it('does not show while the newest notice goes on, once it was delivered, or when only an older one failed', async () => {
    const going = await startedBook();
    await noticeStarted(going, 'passed', monday);
    const delivered = await startedBook();
    await noticeStarted(delivered, 'passed', monday);
    await delivered.append(`runs/${runOf('passed')}`, 'run_succeeded', { output: null, record: {} });
    const older = await startedBook();
    await noticeStarted(older, 'overdue', monday);
    await older.append(`runs/${runOf('overdue')}`, 'run_failed', {});
    await noticeStarted(older, 'passed', monday + minute);

    expect([
      await going.inThePlaybook(noticeGapsIn([heldGoalOf(experimentsGoal)])),
      await delivered.inThePlaybook(noticeGapsIn([heldGoalOf(experimentsGoal)])),
      await older.inThePlaybook(noticeGapsIn([heldGoalOf(experimentsGoal)])),
      await (await startedBook()).inThePlaybook(noticeGapsIn([heldGoalOf(experimentsGoal)])),
    ]).toEqual([[], [], [], []]);
  });
});

describe('the gap words and the newest notice', () => {
  it('names a goal that names no function in its words, and keeps its detail within bounds', () => {
    const notice = { change: 'passed' as const, at: '', run: 'r' };
    const { detail } = noticeUndeliveredGap(
      { ...experimentsGoal, notify: { passed: 'now', failed: 'now' } },
      notice,
      'x'.repeat(400),
    );

    expect(detail.startsWith('The message saying the goal paying-customers passed was not delivered: xxx')).toBe(true);
    expect(new TextEncoder().encode(detail).length).toBeLessThanOrEqual(256);
    expect(
      noticeUndeliveredGap({ ...experimentsGoal, notify: { passed: 'now', failed: 'now' } }, notice, 'gone').detail,
    ).toContain('the expiry of its notification function');
  });

  it('takes the newest of the notices a row lists, and none from a row it cannot read', () => {
    const notices = JSON.stringify([
      { change: 'passed', at: '2026-11-09T10:00:00.000Z', run: 'b' },
      { change: 'overdue', at: '2026-11-09T09:00:00.000Z', run: 'a' },
    ]);

    expect([newestNoticeOf(notices)?.run, newestNoticeOf('not notices'), newestNoticeOf(null)]).toEqual([
      'b',
      undefined,
      undefined,
    ]);
  });
});
