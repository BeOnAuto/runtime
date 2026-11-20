import type { Goal } from '@on.auto/definitions/goals';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { unopened } from '../assessments/assessment-state.ts';
import { dayLimitDetail } from '../notice-limits/notice-day-limit.ts';
import { experimentsGoal, performedAt, sales } from '../notices/notice-samples.ts';
import { summaryNotStartedGap } from './summary-gaps.ts';
import { summaryInputOf } from './summary-input.ts';
import { summarisedIn } from './summary-lines.ts';
import { clockRowPorts, friday, hour, savedAt, summaryBookOf, weekly } from './summary-samples.ts';

const notify = { passed: 'summary', failed: 'summary', summary: { cron: '0 9 * * 5' } } as const;

const goal: Goal = {
  id: 'orders',
  statement: 'Keep the weekly orders coming in from the shop.',
  success: { label: 'Orders', settles: 'on_crossing', target: { at_least: 20 }, passed: 'Enough', failed: 'Short' },
  notify,
};

async function movedWith(
  clock: string,
  {
    definition = experimentsGoal,
    goals = [weekly],
  }: { readonly definition?: string; readonly goals?: Schema.Json } = {},
) {
  const summary = await summaryBookOf({ goals });
  const moved: unknown[] = [];
  const { work } = await summaryBookOf({
    goals,
    ports: clockRowPorts(
      summary.book.ledger,
      clock,
      (key, advance) => {
        moved.push([key, advance]);
      },
      definition,
    ),
  });
  await performedAt(work, friday);
  return moved;
}

describe('a summary where the host knows no address of Studio', () => {
  it('goes without a link, and names a thing it knows nothing of by the goal', () => {
    const input = summaryInputOf({
      goal,
      window: { from: savedAt, to: friday },
      assessments: [{ key: 'a', state: unopened, as: 'passed', at: friday - 1 }],
      counts: { passed: 1, failed: 0, overdue: 0, no_result: 0 },
      owner: { id: 'person:ada', name: 'Ada' },
    });

    expect(input).not.toHaveProperty('link');
    expect(input.lines).toEqual([{ title: goal.statement, word: 'Enough', at: new Date(friday - 1).toISOString() }]);
  });
});

describe('the heartbeat of a summary', () => {
  it('dates the start of its window in the time zone of the summary, else of the calendar window, else UTC', () => {
    const lateSunday = Date.parse('2026-11-09T05:00:00.000Z');
    const heartbeatOf = (of: Goal) =>
      summaryInputOf({
        goal: of,
        window: { from: lateSunday, to: friday },
        assessments: [],
        counts: { passed: 0, failed: 0, overdue: 0, no_result: 0 },
        owner: { id: 'person:ada', name: 'Ada' },
      }).detail;
    const summary = { cron: '0 9 * * 5' };

    expect([
      heartbeatOf({ ...goal, notify: { ...notify, summary: { ...summary, time_zone: 'America/Los_Angeles' } } }),
      heartbeatOf({ ...goal, window: { calendar: 'day', time_zone: 'Asia/Tokyo' } }),
      heartbeatOf({ ...goal, window: { after: 'live', for: 'P7D' } }),
    ]).toEqual([
      'Nothing passed, failed or became overdue since Sunday, November 8.',
      'Nothing passed, failed or became overdue since Monday, November 9.',
      'Nothing passed, failed or became overdue since Monday, November 9.',
    ]);
  });
});

describe('the gap of a summary not sent', () => {
  it('names the function that sends the summary, else the one of the notices, else none', () => {
    const through = (told: NonNullable<Goal['notify']>) =>
      summaryNotStartedGap({ ...goal, notify: told }, 'refused').detail;

    expect([
      through({ ...notify, summary: { cron: '0 9 * * 5', through: 'weekly-note' } }),
      through({ ...notify, through: 'tell-owner' }),
      through(notify),
    ]).toEqual([
      expect.stringContaining('Make sure weekly-note is saved'),
      expect.stringContaining('Make sure tell-owner is saved'),
      expect.stringContaining('Make sure its notification function is saved'),
    ]);
    expect(summaryNotStartedGap(goal, dayLimitDetail(sales, friday)).detail).toBe(
      'The summary of the goal orders was not sent, because the playbook sales reached its limit of 200 messages and summaries on 2026-11-13 (UTC). Nothing needs fixing: sending resumes on the next UTC day.',
    );
  });
});

describe('the gap of a summary whose refusal ends a sentence', () => {
  it('ends that sentence once', () => {
    expect(summaryNotStartedGap(goal, 'The function weekly-note is paused.').detail).toContain(
      'was not sent. The function weekly-note is paused. Make sure',
    );
  });
});

describe('a row of assessments that holds no state or moments', () => {
  it('is read as a thing with nothing known of it', async () => {
    const summary = await summaryBookOf();
    const found = await Effect.runPromise(
      summarisedIn({
        ledger: {
          ...summary.book.ledger,
          readProjectedRows: () => Effect.succeed([{ org: 'acme', playbook: 'sales', key: 'bare', row: {} }]),
          countProjectedRows: () => Effect.succeed(1),
        },
        address: sales,
        goal: { org: 'acme', definition: experimentsGoal },
        name: goal.id,
        window: { from: savedAt, to: friday },
      }),
    );

    expect(found.assessments).toEqual([
      { key: 'bare', state: unopened, as: 'no_result', at: 0 },
      { key: 'bare', state: unopened, as: 'overdue', at: 0 },
    ]);
  });
});

describe('a clock row that does not read as its goal does', () => {
  it('moves past the present, starting nothing, when the goal was retired since the row was read', async () => {
    const clock = JSON.stringify({
      first_saved_at: savedAt,
      summary: { cron: '0 9 * * 5', time_zone: 'Europe/London' },
    });
    const when = [
      { column: 'summary_at', before: friday + 1 },
      { column: 'clock', equals: clock },
    ];

    expect(await movedWith(clock, { goals: [{ ...weekly, retired: true }] })).toEqual([
      ['clock', { set: { summary_at: friday + 7 * 24 * hour }, when }],
    ]);
  });

  it('moves to no time at all when the goal is retired or has no schedule that can come due again', async () => {
    const retired = JSON.stringify({ first_saved_at: savedAt, retired: true, summary: { cron: '0 9 * * 5' } });
    const broken = JSON.stringify({ first_saved_at: savedAt, summary: { cron: 'not a cron' } });

    expect([await movedWith(retired), await movedWith(broken)]).toMatchObject([
      [['clock', { set: { summary_at: null } }]],
      [['clock', { set: { summary_at: null } }]],
    ]);
  });
});

describe('a clock row the summaries cannot work here', () => {
  it('leaves the row of a goal another playbook holds now to that playbook, and a row it cannot read', async () => {
    const clock = JSON.stringify({ first_saved_at: savedAt, summary: { cron: '0 9 * * 5' } });

    expect([await movedWith(clock, { definition: 'goal-held-elsewhere' }), await movedWith('not a clock')]).toEqual([
      [],
      [],
    ]);
  });

  it('moves nothing when no row is left to move', async () => {
    const summary = await summaryBookOf();
    const moved: unknown[] = [];
    const { work } = await summaryBookOf({
      ports: (ports) => {
        const over = clockRowPorts(summary.book.ledger, '{}', (key) => {
          moved.push(key);
        })(ports);
        return { ...over, ledger: { ...over.ledger, readProjectedRows: () => Effect.succeed([]) } };
      },
    });
    await performedAt(work, friday);

    expect(moved).toEqual([]);
  });
});
