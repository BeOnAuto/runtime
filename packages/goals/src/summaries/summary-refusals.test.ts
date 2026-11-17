import type { Goal } from '@on.auto/definitions/goals';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostNoticesADay } from '../notice-limits/notice-day-limit.ts';
import { noticeGapsIn } from '../notices/notice-gaps.ts';
import { performedAt, sales } from '../notices/notice-samples.ts';
import {
  friday,
  fridayRun,
  inTurn,
  savedAt,
  summaryBookOf,
  summaryReference,
  week,
  weekly,
} from './summary-samples.ts';

const anyWords: unknown = expect.any(String);

const minute = 60_000;

describe('a summary the runtime cannot start now', () => {
  it('is tried again with backoff, six times in all, then shows as a gap until the next time sends one', async () => {
    let answer: 'unavailable' | 'started' = 'unavailable';
    const summary = await summaryBookOf({ answers: () => answer });
    const tried = [0, 1, 3, 7, 15, 31].map((minutes) => friday + minutes * minute);
    const moved: unknown[] = [];
    await inTurn(tried, async (at) => {
      await performedAt(summary.work, at);
      moved.push(await summary.summaryAt());
    });
    await performedAt(summary.work, friday + 40 * minute);
    const row = await summary.summaryRow();
    answer = 'started';
    await performedAt(summary.work, friday + week);

    expect(moved).toEqual([...tried.slice(1), friday + week]);
    expect(summary.starts).toHaveLength(7);
    expect(row).toMatchObject({ attempt: 6, retry_at: null });
    expect(String(row?.['detail'])).toMatch(/tried 6 times and is not tried again$/u);
    expect(await summary.summaryFacts()).toEqual(Array.from({ length: 6 }, () => 'goal_notice_refused'));
    expect(summary.starts.at(-1)?.runId).toBe(fridayRun(friday + week));
    expect(await summary.summaryAt()).toBe(friday + week + minute);
  });
});

describe('a summary the runtime cannot start now', () => {
  it('waits for its retry when the row comes due before it', async () => {
    const summary = await summaryBookOf({ answers: () => 'unavailable' });
    await performedAt(summary.work, friday);
    await Effect.runPromise(
      summary.book.ledger.advanceRow('goal_clocks', sales, 'clock', { set: { summary_at: friday }, when: [] }),
    );
    await performedAt(summary.work, friday + 1000);

    expect(summary.starts).toHaveLength(1);
    expect(await summary.summaryAt()).toBe(friday + minute);
  });
});

describe('a summary refused for good', () => {
  it('is refused once by a function that refuses it, and nothing is tried until the next time', async () => {
    const summary = await summaryBookOf({ answers: () => 'rejected' });
    await performedAt(summary.work, friday);
    await Effect.runPromise(
      summary.book.ledger.advanceRow('goal_clocks', sales, 'clock', { set: { summary_at: friday }, when: [] }),
    );
    await performedAt(summary.work, friday + minute);

    expect(summary.starts).toHaveLength(1);
    expect(await summary.summaryRow()).toMatchObject({
      attempt: 1,
      retry_at: null,
      detail: anyWords,
    });
    expect(await summary.summaryAt()).toBe(friday + week);
  });
});

describe('a summary refused for good', () => {
  it('is refused when the goal names no function to send it', async () => {
    const { notify } = weekly;
    const summary = await summaryBookOf({
      goals: [
        {
          ...weekly,
          notify: { passed: notify.passed, failed: notify.failed, overdue: notify.overdue, summary: notify.summary },
        },
      ],
    });
    await performedAt(summary.work, friday);

    expect(summary.starts).toEqual([]);
    expect(await summary.summaryRow()).toMatchObject({
      detail: 'The goal paying-customers names no notification function for its summary',
      retry_at: null,
    });
  });
});

describe('a summary refused for good', () => {
  it('is refused past the 200 a day, and still counted toward them when it goes', async () => {
    const summary = await summaryBookOf();
    const started = {
      due: new Date(friday).toISOString(),
      window: { from: new Date(savedAt).toISOString(), to: new Date(friday).toISOString() },
      run: 'other',
    };
    await inTurn(Array.from({ length: mostNoticesADay }), async () => {
      await summary.book.append('goal-summaries/other', 'goal_summary_started', started, {
        at: new Date(friday).toISOString(),
      });
    });
    await performedAt(summary.work, friday);

    expect(summary.starts).toEqual([]);
    expect(String((await summary.summaryRow())?.['detail'])).toMatch(
      /reached its limit of 200 messages and summaries on 2026-11-13/u,
    );
  });
});

describe('the owner of a playbook that cannot be read now', () => {
  it('is tried again, as an unavailable start is', async () => {
    const summary = await summaryBookOf({
      ports: (ports) => ({ ...ports, playbookOf: () => Effect.succeed({ status: 'active' }) }),
    });
    await performedAt(summary.work, friday);

    expect(summary.starts).toEqual([]);
    expect(await summary.summaryRow()).toMatchObject({ attempt: 1, retry_at: friday + minute });
    expect(await summary.summaryAt()).toBe(friday + minute);
  });
});

const weeklyGoal: Goal = {
  id: weekly.id,
  statement: weekly.statement,
  per: 'experiment',
  success: {
    label: 'New paying customers',
    settles: 'on_crossing',
    target: { at_least: 1 },
    passed: 'Brought a customer',
    failed: 'Brought no customer',
  },
  notify: {
    passed: 'now',
    failed: 'quiet',
    overdue: 'summary',
    summary: { cron: '0 9 * * 5', through: 'weekly-note' },
  },
};

const quietGoal: Goal = { ...weeklyGoal, id: 'quiet-goal', notify: { passed: 'quiet', failed: 'quiet' } };

describe('the gap of a summary refused for good', () => {
  it('shows once it is refused, names the function that sends it, and goes once a summary is sent', async () => {
    const summary = await summaryBookOf({ goals: [weeklyGoal], answers: () => 'rejected' });
    const gapsNow = () => summary.book.inThePlaybook(noticeGapsIn([weeklyGoal, quietGoal]));
    const before = await gapsNow();
    await performedAt(summary.work, friday);
    const refused = await gapsNow();
    await summary.book.runStarted(fridayRun(friday + week), summaryReference(friday + week));
    await performedAt(summary.work, friday + week);

    expect(before).toEqual([]);
    expect(refused).toEqual([
      {
        kind: 'notice_not_started',
        goal: weekly.id,
        detail:
          'The summary of the goal paying-customers was not sent. The function weekly-note refused the summary: The function tell-owner is paused. Make sure weekly-note is saved, active and accepts the fields of a summary; the next summary is then sent.',
        fixed_by: 'agent',
      },
    ]);
    expect(await gapsNow()).toEqual([]);
  });
});

describe('the gap of a summary still to be tried again', () => {
  it('is not shown', async () => {
    const summary = await summaryBookOf({ goals: [weeklyGoal], answers: () => 'unavailable' });
    await performedAt(summary.work, friday);

    expect(await summary.book.inThePlaybook(noticeGapsIn([weeklyGoal]))).toEqual([]);
  });
});
