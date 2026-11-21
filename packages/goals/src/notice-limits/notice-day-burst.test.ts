import type { DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { goalNoticesOf } from '../notices/goal-notices.ts';
import {
  experiments,
  experimentsGoal,
  monday,
  noticeBookOf,
  sales,
  startsAnswering,
  type NoticeBook,
} from '../notices/notice-samples.ts';
import { noticesOwedOf } from '../notices/notice-starts.ts';
import { noticedPlaybookIn } from '../notices/noticed-playbooks.ts';
import { dayLimitDetail, noStartsMade } from './notice-day-limit.ts';

const mostADay = 5;

const minute = 60_000;

const atOnce = 16;

const told = { ...experiments, notify: { ...experiments.notify, failed: 'now', summary: { cron: '0 9 * * 1' } } };

const goalIn = (playbook: string) => (playbook === 'sales' ? experimentsGoal : `${playbook}-${told.id}`);

async function judgedAll(book: NoticeBook, count: number, playbook = 'sales'): Promise<void> {
  const things = Array.from({ length: count }, (_, index) => `experiment-${String(index)}`);
  await Effect.runPromise(
    Effect.forEach(
      things,
      (per) =>
        Effect.promise(async () => {
          const definition = goalIn(playbook);
          const stream = `definition/acme/${definition}/assessments/${assessmentIdOf({ definition, per })}`;
          const opened = {
            goal_version: 1,
            per: { id: per },
            rule: { settles: 'on_crossing', target: { at_least: 1 } },
            milestones: told.milestones,
          };
          const context = {
            at: new Date(monday - minute).toISOString(),
            by: `playbook:${playbook}`,
            definitionId: definition,
          };
          await book.appendAt(stream, 'goal_assessment_opened', opened, context);
          const verdict = { verdict: 'failed', at: context.at, by: 'crossing', told: 'now' };
          await book.appendAt(stream, 'goal_assessed', verdict, context);
        }),
      { concurrency: atOnce },
    ),
  );
}

async function performedTogether(works: readonly DueWork[], now: number): Promise<void> {
  const batches = await Effect.runPromise(Effect.forEach(works, (work) => work.due(now, 256, false)));
  const items = batches.flat();
  await Effect.runPromise(Effect.forEach(items, ({ perform }) => perform(now), { concurrency: atOnce }));
}

async function refusedFor(book: NoticeBook, detail: string): Promise<number> {
  const rows = await Effect.runPromise(
    book.ledger.readProjectedRows(assessmentsName, sales, { where: [], orderBy: [], order: 'asc', limit: 1000 }),
  );
  return rows.filter(({ row }) => String(row['notice_refusals']).includes(detail)).length;
}

async function burstOf(count: number) {
  const book = noticeBookOf();
  await book.playbookCreated();
  await book.goalsSaved([told]);
  await judgedAll(book, count);
  return { book, seen: startsAnswering(() => 'started') };
}

describe('a burst of notices owed at one moment, none of whose starts is seen yet', () => {
  it.each([
    [8, 5],
    [5, 5],
    [4, 4],
  ])(
    'of %i starts at most the most a day, %i, counting each start as it is made, and refuses the rest',
    async (owed, started) => {
      const { book, seen } = await burstOf(owed);
      const work = noticesOwedOf(
        { ledger: book.ledger, start: seen.start, playbookOf: noticedPlaybookIn(book.ledger) },
        noStartsMade(mostADay),
      );
      await performedTogether([work], monday);
      await performedTogether([work], monday + 2 * minute);

      expect(new Set(seen.starts.map(({ runId }) => runId)).size).toBe(started);
      expect(await refusedFor(book, dayLimitDetail(sales, monday, mostADay))).toBe(owed - started);
    },
  );

  it('counts the starts of notices and summaries of one playbook together', async () => {
    const { book, seen } = await burstOf(mostADay);
    const parts = goalNoticesOf({
      ledger: book.ledger,
      start: seen.start,
      playbookOf: noticedPlaybookIn(book.ledger),
      now: () => monday,
      mostADay,
    });
    await performedTogether(parts.dueWork, monday);

    expect(seen.starts).toHaveLength(mostADay);
    expect(seen.starts.some(({ trigger }) => trigger.reference.includes('/summaries/'))).toBe(false);
    expect(await book.factsOf('goal-summaries/summary')).toEqual(['goal_notice_refused']);
  });
});

async function seenEarlier(book: NoticeBook, count: number): Promise<void> {
  const at = new Date(monday - 60 * minute).toISOString();
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      book.ofTheGoal(
        `goal-summaries/earlier-${String(index)}`,
        'goal_notice_started',
        { due: at, run: `earlier-${String(index)}` },
        { at, by: 'playbook:sales' },
      ),
    ),
  );
}

describe('a burst owed after a restart, with starts already seen that day', () => {
  it('counts the starts seen and the starts made since, so 3 seen and 5 owed start the 2 left of 5', async () => {
    const { book, seen } = await burstOf(5);
    await seenEarlier(book, 3);
    const restarted = noticesOwedOf(
      { ledger: book.ledger, start: seen.start, playbookOf: noticedPlaybookIn(book.ledger) },
      noStartsMade(mostADay),
    );
    await performedTogether([restarted], monday);
    await performedTogether([restarted], monday + 2 * minute);

    expect(new Set(seen.starts.map(({ runId }) => runId)).size).toBe(2);
    expect(await refusedFor(book, dayLimitDetail(sales, monday, mostADay))).toBe(3);
  });
});

describe('the notices of two playbooks in one host', () => {
  it('keeps the count of each playbook apart, so two playbooks in one host owing the most each start the most each', async () => {
    const { book, seen } = await burstOf(mostADay);
    await book.playbookFact('playbook_created', {
      playbook: 'north',
      name: 'North',
      description: 'North',
      created_by: { id: 'person:ada', name: 'Ada' },
    });
    await book.appendAt(
      `definition/acme/${goalIn('north')}/goals/goal`,
      'goal_created',
      { playbook: 'north', position: 0, goal: told },
      { definitionId: goalIn('north') },
    );
    await judgedAll(book, mostADay, 'north');
    const parts = goalNoticesOf({
      ledger: book.ledger,
      start: seen.start,
      playbookOf: noticedPlaybookIn(book.ledger),
      now: () => monday,
      mostADay,
    });
    await performedTogether(parts.dueWork.slice(0, 1), monday);
    await performedTogether(parts.dueWork.slice(0, 1), monday);

    expect(
      ['sales', 'north'].map((playbook) => seen.starts.filter((start) => start.playbook === playbook).length),
    ).toEqual([mostADay, mostADay]);
  });
});
