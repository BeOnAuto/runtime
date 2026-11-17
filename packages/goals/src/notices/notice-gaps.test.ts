import type { Goal } from '@on.auto/definitions/goals';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { dayLimitDetail } from '../notice-limits/notice-day-limit.ts';
import { noticeGapsIn, noticeNotStartedGap } from './notice-gaps.ts';
import {
  assessment,
  experiments,
  monday,
  noticeBookOf,
  owner,
  runOf,
  sales,
  startsAnswering,
} from './notice-samples.ts';
import { noticesOwedOf } from './notice-starts.ts';
import { noticedKeptOf, type NoticedPlaybook, noticedPlaybookIn } from './noticed-playbooks.ts';

const anyWords: unknown = expect.any(String);

describe('the playbook a notice is sent for', () => {
  it('is unknown before it is created, then active with its owner, retired, and active again once restored', async () => {
    const book = noticeBookOf();
    const noticed = noticedPlaybookIn(book.ledger);
    const before = await Effect.runPromise(noticed(sales));
    await book.playbookCreated();
    await book.playbookFact('playbook_created', {
      playbook: 'other',
      name: 'Other',
      description: 'Other',
      created_by: { id: 'person:ben', name: 'Ben' },
    });
    await book.playbookFact('playbook_updated', { playbook: 'sales', name: 'Sales again' });
    const created = await Effect.runPromise(noticed(sales));
    await book.playbookRetired();
    const retired = await Effect.runPromise(noticed(sales));
    await book.playbookFact('playbook_restored', { playbook: 'sales' });
    const restored = await Effect.runPromise(noticed(sales));

    expect([before, created, retired, restored]).toEqual([
      { status: 'unknown' },
      { status: 'active', owner },
      { status: 'retired', owner },
      { status: 'active', owner },
    ]);
  });
});

describe('the playbook a notice is sent for, kept a while', () => {
  it('is asked once for every notice of a piece of work, and again once the while has passed', async () => {
    const asked: string[] = [];
    const clock = { now: 0 };
    const held: { answer: NoticedPlaybook } = { answer: { status: 'active', owner } };
    const kept = noticedKeptOf(
      ({ playbook }) =>
        Effect.sync(() => {
          asked.push(playbook);
          return held.answer;
        }),
      { keptMs: 5000, now: () => clock.now },
    );
    const first = await Promise.all(Array.from({ length: 10 }, () => Effect.runPromise(kept(sales))));
    clock.now = 5000;
    held.answer = { status: 'retired', owner };
    const later = await Effect.runPromise(kept(sales));

    expect(first).toEqual(Array.from({ length: 10 }, () => ({ status: 'active', owner })));
    expect([later, asked]).toEqual([{ status: 'retired', owner }, ['sales', 'sales']]);
  });
});

const experimentsNotify = { passed: 'now', failed: 'quiet', through: 'tell-owner' } as const;

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
  notify: experimentsNotify,
};

const goals: readonly Goal[] = [experimentsGoal];

async function refusedBook(overdueToo = false) {
  const book = noticeBookOf();
  await book.playbookCreated();
  await book.goalsSaved([experiments]);
  await book.opened();
  if (overdueToo) {
    await book.append(`assessments/${assessment}`, 'goal_overdue', {
      since: new Date(monday).toISOString(),
      told: 'now',
    });
  }
  await book.assessed('passed', 'now');
  const { start } = startsAnswering(() => 'rejected');
  const work = noticesOwedOf({ ledger: book.ledger, start, playbookOf: noticedPlaybookIn(book.ledger) });
  const items = await Effect.runPromise(work.due(monday, 10, false));
  await Effect.runPromise(Effect.forEach(items, (item) => item.perform(monday)));
  return book;
}

describe('the gap of a notice that was not started', () => {
  it('shows for a goal whose newest notice was refused for good, and not for a retired goal', async () => {
    const book = await refusedBook();
    const gaps = await book.inThePlaybook(noticeGapsIn(goals));
    const retired = await book.inThePlaybook(noticeGapsIn(goals.map((goal) => ({ ...goal, retired: true }))));

    expect(gaps).toEqual([
      {
        kind: 'notice_not_started',
        goal: experiments.id,
        detail: anyWords,
        fixed_by: 'agent',
      },
    ]);
    expect(retired).toEqual([]);
  });

  it('names the later of two refusals of one assessment', async () => {
    const book = await refusedBook(true);
    const gaps = await book.inThePlaybook(noticeGapsIn(goals));

    expect(gaps.map(({ detail }) => detail.slice(0, 60))).toEqual([
      'The message saying the goal paying-customers passed was not ',
    ]);
  });
});

describe('the gap of a notice that was not started, once one did', () => {
  it('goes once a later notice of the goal started', async () => {
    const book = await refusedBook();
    await book.append(
      `assessments/${assessment}`,
      'goal_notice_started',
      { change: 'failed', run: runOf('failed') },
      {
        at: new Date(monday + 60_000).toISOString(),
      },
    );

    expect(await book.inThePlaybook(noticeGapsIn(goals))).toEqual([]);
  });
});

describe('the words of the gap of a notice that was not started', () => {
  it('names the overdue and a goal that names no function in its words', () => {
    const { detail } = noticeNotStartedGap(
      { ...experimentsGoal, notify: { passed: 'now', failed: 'now' } },
      { change: 'overdue', attempt: 1, detail: 'Gone', at: '' },
    );

    expect([detail]).toEqual([
      'The message saying the goal paying-customers became overdue was not sent. Gone. Make sure its notification function is saved, active and accepts the fields of a message; the next message is then sent.',
    ]);
  });
});

describe('the words of the gap of a notice whose refusal ends a sentence', () => {
  it('end that sentence once', () => {
    const { detail } = noticeNotStartedGap(
      { ...experimentsGoal, notify: { passed: 'now', failed: 'now' } },
      { change: 'overdue', attempt: 1, detail: 'The function tell-owner is paused.', at: '' },
    );

    expect(detail).toBe(
      'The message saying the goal paying-customers became overdue was not sent. The function tell-owner is paused. Make sure its notification function is saved, active and accepts the fields of a message; the next message is then sent.',
    );
  });
});

describe('the words of the gap of a notice past the limit of a day', () => {
  it('say nothing needs fixing, and name the next summary only where the goal has one', () => {
    const refusal = { change: 'failed', attempt: 1, detail: dayLimitDetail(sales, monday), at: '' } as const;
    const withSummary = { ...experimentsGoal, notify: { ...experimentsNotify, summary: { cron: '0 9 * * 5' } } };
    const withoutSummary = { ...experimentsGoal, notify: { passed: 'now', failed: 'now' } } as const;

    expect([
      noticeNotStartedGap(withSummary, refusal).detail,
      noticeNotStartedGap(withoutSummary, refusal).detail,
    ]).toEqual([
      'The message saying the goal paying-customers failed was not sent, because the playbook sales reached its limit of 200 messages and summaries on 2026-11-09 (UTC). Nothing needs fixing: sending resumes on the next UTC day, and the change shows in Studio and in the next summary.',
      'The message saying the goal paying-customers failed was not sent, because the playbook sales reached its limit of 200 messages and summaries on 2026-11-09 (UTC). Nothing needs fixing: sending resumes on the next UTC day, and the change shows in Studio.',
    ]);
  });
});
