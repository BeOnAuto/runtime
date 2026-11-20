import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { summaryRunIdOf } from '../assessments/assessment-identity.ts';
import { noticeDaysName } from '../goal-tables/notice-days.ts';
import { aDay } from '../goal-windows/goal-durations.ts';
import { experimentsGoal, performedAt, sales } from '../notices/notice-samples.ts';
import { noticesSeenOf } from '../notices/notices-seen.ts';
import {
  friday,
  fridayRun,
  hour,
  inputOf,
  iso,
  savedAt,
  summaryBookOf,
  summaryReference,
  week,
  weekly,
} from './summary-samples.ts';

const anyWords: unknown = expect.any(String);

const minute = 60_000;

const reference = summaryReference;

async function seenBy(summary: Awaited<ReturnType<typeof summaryBookOf>>, run: string, due = friday) {
  const record = await summary.book.runStarted(run, reference(due));
  const consumer = noticesSeenOf(summary.book.ledger, () => due + minute);
  const { deliveries } = await Effect.runPromise(consumer.batchOf({ playbook: sales, record }));
  await Effect.runPromise(Effect.forEach(deliveries, ({ deliver }) => deliver));
  return deliveries.length;
}

describe('the summary of a goal, as work due on its clock row', () => {
  it('is due at the first time of its schedule after the goal was first saved, and on no lane that calls out', async () => {
    const { work, summaryAt } = await summaryBookOf();

    expect(await summaryAt()).toBe(friday);
    expect(await Effect.runPromise(work.nextDueAt(savedAt))).toBe(friday);
    expect(await Effect.runPromise(work.nextDueAt(savedAt, true))).toBeNull();
    expect(await Effect.runPromise(work.due(friday, 10, true))).toEqual([]);
    expect(await performedAt(work, friday - 1)).toBe(0);
  });
});

describe('the summary of a goal, as work due on its clock row', () => {
  it('sends a summary with no lines as the heartbeat, under its own run id and trigger, and waits to see it start', async () => {
    const { work, starts, summaryAt, summaryFacts } = await summaryBookOf();
    await performedAt(work, friday);

    expect(starts).toEqual([
      expect.objectContaining({
        org: 'acme',
        playbook: 'sales',
        type: 'interaction',
        name: 'tell-owner',
        runId: fridayRun(),
        trigger: { kind: 'goal', reference: reference() },
      }),
    ]);
    expect(inputOf(starts[0])).toEqual({
      change: 'summary',
      headline: 'Bring in paying customers through my experiments: 0 passed, 0 failed, 0 with no result',
      detail: anyWords,
      window: { from: new Date(savedAt).toISOString(), to: new Date(friday).toISOString() },
      counts: { passed: 0, failed: 0, overdue: 0, no_result: 0 },
      lines: [],
      more: 0,
      link: 'https://studio.test/?playbook=sales&goal=paying-customers',
      owner: { id: 'person:ada', name: 'Ada' },
      goal: { id: weekly.id, statement: weekly.statement },
    });
    expect(await summaryAt()).toBe(friday + minute);
    expect(await summaryFacts()).toEqual([]);
  });
});

describe('the summary of a goal, as work due on its clock row', () => {
  it('records the summary started with its window once its run is seen, which moves the row to the next time', async () => {
    const summary = await summaryBookOf();
    await performedAt(summary.work, friday);
    const delivered = await seenBy(summary, fridayRun());
    await seenBy(summary, fridayRun());
    const facts = await summary.summaryFacts();
    await performedAt(summary.work, friday + minute);

    expect(delivered).toBe(1);
    expect(facts).toEqual(['goal_summary_started']);
    expect(await summary.summaryRow()).toMatchObject({ last_due: friday, last_run: fridayRun() });
    expect(await summary.summaryAt()).toBe(friday + week);
    expect(summary.starts).toHaveLength(1);
    expect(
      await Effect.runPromise(
        summary.book.ledger.readProjectedRows(noticeDaysName, sales, {
          where: [],
          orderBy: [],
          order: 'asc',
          limit: 2,
        }),
      ),
    ).toMatchObject([{ key: '2026-11-13', row: { started: 1 } }]);
  });
});

describe('the summary of a goal, as work due on its clock row', () => {
  it('records a summary whose run already started without starting it again', async () => {
    const summary = await summaryBookOf();
    await summary.book.runStarted(fridayRun(), reference());
    await performedAt(summary.work, friday);

    expect(summary.starts).toEqual([]);
    expect(await summary.summaryFacts()).toEqual(['goal_summary_started']);
    expect(await summary.summaryAt()).toBe(friday + week);
  });
});

describe('the summary of a goal, as work due on its clock row', () => {
  it('collapses the times missed while nothing ran into one summary, whose window starts at the last one sent', async () => {
    const summary = await summaryBookOf();
    await performedAt(summary.work, friday);
    await seenBy(summary, fridayRun());
    const late = friday + 3 * week + 5 * hour;
    await performedAt(summary.work, late);

    expect(summary.starts.map(({ runId }) => runId)).toEqual([fridayRun(), fridayRun(friday + 3 * week)]);
    expect(inputOf(summary.starts[1])['window']).toEqual({
      from: new Date(friday).toISOString(),
      to: new Date(friday + 3 * week).toISOString(),
    });
    expect(await summary.summaryAt()).toBe(late + 5 * hour);
  });
});

describe('the summary of a goal, as work due on its clock row', () => {
  it('a run seen for an older time records nothing once a later summary is sent', async () => {
    const summary = await summaryBookOf();
    await summary.book.runStarted(fridayRun(friday + week), reference(friday + week));
    await performedAt(summary.work, friday + week);
    await seenBy(summary, fridayRun(), friday);

    expect(await summary.summaryFacts()).toEqual(['goal_summary_started']);
  });
});

describe('a retired playbook or goal', () => {
  it('sends no summary from a retired playbook, appends nothing and wakes at most once a day', async () => {
    const hourly = { ...weekly, notify: { ...weekly.notify, summary: { cron: '0 * * * *' } } };
    const summary = await summaryBookOf({ goals: [hourly] });
    await summary.book.playbookRetired();
    await performedAt(summary.work, friday);

    expect(summary.starts).toEqual([]);
    expect(await summary.summaryFacts()).toEqual([]);
    expect(await summary.summaryAt()).toBe(Date.parse('2026-11-14T00:00:00.000Z'));
  });

  it('treats a playbook it cannot find as retired, and sends the summaries it held back in one after a restore', async () => {
    const hourly = { ...weekly, notify: { ...weekly.notify, summary: { cron: '0 * * * *' } } };
    const unknown = await summaryBookOf({
      goals: [hourly],
      ports: (ports) => ({ ...ports, playbookOf: () => Effect.succeed({ status: 'unknown' }) }),
    });
    const restored = await summaryBookOf({ goals: [hourly] });
    await restored.book.playbookRetired();
    await performedAt(unknown.work, friday);
    await performedAt(restored.work, friday);
    await restored.book.playbookFact('playbook_restored', { playbook: 'sales' });
    const wokenAgain = await performedAt(restored.work, friday + hour);
    const restoredAt = await performedAt(restored.work, friday + aDay);

    expect([unknown.starts, await unknown.summaryAt()]).toEqual([[], Date.parse('2026-11-14T00:00:00.000Z')]);
    expect([wokenAgain, restoredAt, restored.starts.length]).toEqual([0, 1, 1]);
    expect(inputOf(restored.starts[0])).toMatchObject({ window: { to: iso(friday + aDay) } });
    expect(await restored.summaryAt()).toBe(friday + aDay + minute);
  });
});

describe('a retired playbook or goal', () => {
  it('owes no summary for a retired goal', async () => {
    const summary = await summaryBookOf({ goals: [{ ...weekly, retired: true }] });

    expect(await summary.summaryAt()).toBeNull();
    expect(await performedAt(summary.work, friday + week)).toBe(0);
  });
});

const windowsOf = (starts: Awaited<ReturnType<typeof summaryBookOf>>['starts']) =>
  starts.map((start) => inputOf(start)['window']);

describe('an hourly summary started and not yet seen when the next hour comes', () => {
  const hourly = { ...weekly, notify: { ...weekly.notify, summary: { cron: '0 * * * *' } } };

  it('records the earlier one seen when its run has started, and sends the next from its due in the same pass', async () => {
    const summary = await summaryBookOf({ goals: [hourly] });
    await performedAt(summary.work, friday);
    await summary.book.runStarted(summaryRunIdOf(experimentsGoal, friday), reference(friday));
    await performedAt(summary.work, friday + hour);

    expect(windowsOf(summary.starts)).toEqual([
      { from: iso(savedAt), to: iso(friday) },
      { from: iso(friday), to: iso(friday + hour) },
    ]);
    expect(await summary.summaryFacts()).toEqual(['goal_summary_started']);
  });
});
