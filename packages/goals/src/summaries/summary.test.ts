import { Conflict } from '@on.auto/operations';
import { Effect, Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentIdOf, summaryRunIdOf } from '../assessments/assessment-identity.ts';
import { performedAt, sales } from '../notices/notice-samples.ts';
import { noticesSeenOf } from '../notices/notices-seen.ts';
import { summaryRecorded, summarySeenIn } from './summary-ledger.ts';
import {
  friday,
  fridayRun,
  hour,
  inputOf,
  iso,
  linesOf,
  savedAt,
  type SummaryBook,
  summaryBookOf,
  summaryReference,
  thingsJudged,
  week,
  weekly,
  windowsEnded,
} from './summary-samples.ts';

describe('what is taken for the start of a summary', () => {
  it('is a run under the id of a goal and a time, triggered by the goal for that time', async () => {
    const summary = await summaryBookOf();
    const record = await summary.book.runStarted(fridayRun(), summaryReference());
    const { trigger: _trigger, ...untriggered } = record.context;
    const reference = summaryReference();

    expect([
      summarySeenIn(record),
      summarySeenIn({ ...record, context: untriggered }),
      summarySeenIn({ ...record, context: { ...record.context, trigger: { kind: 'cron', reference } } }),
      summarySeenIn({ ...record, stream: 'playbook/acme/sales/runs/another' }),
      summarySeenIn({ ...record, stream: 'playbook/acme/sales/goals/playbook' }),
      summarySeenIn({
        ...record,
        context: { ...record.context, trigger: { kind: 'goal', reference: `goals/${weekly.id}/summaries/never` } },
      }),
    ]).toEqual([
      { goal: weekly.id, due: friday, run: fridayRun() },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('the start of a summary seen by the consumer', () => {
  it('records nothing for a goal its clock does not know', async () => {
    const summary = await summaryBookOf();
    const unknown = await summary.book.runStarted(
      summaryRunIdOf('another-goal', friday),
      `goals/another-goal/summaries/${iso(friday)}`,
    );
    const seen = noticesSeenOf(summary.book.ledger, () => friday);
    const batch = await Effect.runPromise(seen.batchOf({ playbook: sales, record: unknown }));
    await Effect.runPromise(Effect.forEach(batch.deliveries, ({ deliver }) => deliver));
    await Effect.runPromise(Effect.forEach(batch.deliveries, ({ skipped }) => skipped()));

    expect(batch.deliveries.map(({ workflow }) => workflow)).toEqual(['goal notices seen']);
    expect(await summary.book.factsOf('goal-summaries/another-goal')).toEqual([]);
  });

  it('fails the delivery for a retry when the start cannot be recorded now', async () => {
    const summary = await summaryBookOf();
    const known = await summary.book.runStarted(fridayRun(), summaryReference());
    const failing = noticesSeenOf(
      { ...summary.book.ledger, execute: () => Effect.fail(new Conflict({ detail: 'Another append came first' })) },
      () => friday,
    );
    const { deliveries } = await Effect.runPromise(failing.batchOf({ playbook: sales, record: known }));
    const exits = await Promise.all(deliveries.map(({ deliver }) => Effect.runPromise(Effect.exit(deliver))));

    expect(exits).toMatchObject([
      Exit.fail({ detail: `The start of the summary ${fridayRun()} could not be recorded now` }),
    ]);
  });

  it('takes no run that is neither a notice nor a summary, and names the function of one that is', async () => {
    const summary = await summaryBookOf();
    const plain = await summary.book.runStarted('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', 'schedules/nightly');
    const known = await summary.book.runStarted(fridayRun(), summaryReference());
    const seen = noticesSeenOf(summary.book.ledger, () => friday);
    const named = { ...known, context: { ...known.context, definitionName: 'weekly-note' } };
    const batches = await Effect.runPromise(
      Effect.forEach([plain, named], (record) => seen.batchOf({ playbook: sales, record })),
    );

    expect(batches.map(({ deliveries }) => deliveries.map(({ workflow }) => workflow))).toEqual([[], ['weekly-note']]);
  });
});

describe('a refusal of a summary already sent', () => {
  it('records nothing', async () => {
    const summary = await summaryBookOf();
    await summary.book.runStarted(fridayRun(), summaryReference());
    await performedAt(summary.work, friday);
    await Effect.runPromise(
      summaryRecorded(summary.book.ledger, sales, weekly.id, {
        kind: 'refused',
        due: friday,
        attempt: 1,
        detail: 'Too late',
        at: iso(friday + 60_000),
        by: 'playbook:sales',
      }),
    );

    expect(await summary.summaryFacts()).toEqual(['goal_summary_started']);
  });
});

async function summarisedThings() {
  const summary = await summaryBookOf();
  await thingsJudged(summary, 22);
  await performedAt(summary.work, friday);
  return summary.starts[0];
}

describe('a summary of more things than it has lines for', () => {
  it('counts every thing by its latest state and shows at most 20 lines with the count of the rest', async () => {
    const input = inputOf(await summarisedThings());

    expect(input['counts']).toEqual({ passed: 10, failed: 11, overdue: 1, no_result: 0 });
    expect(input['more']).toBe(2);
    expect(input['headline']).toBe(
      'Bring in paying customers through my experiments: 10 passed, 11 failed, 1 with no result',
    );
    expect(String(input['detail']).split('\n').at(-1)).toBe('and 2 more');
  });
});

describe('the lines of a summary', () => {
  it('names each thing by its own title or id, with its value, and links it to its place in Studio', async () => {
    const lines = linesOf(await summarisedThings());

    expect(lines).toHaveLength(20);
    expect(lines.slice(0, 2)).toEqual([
      {
        title: 'The spring trial',
        word: 'Brought no customer',
        value: 0,
        at: iso(savedAt + hour),
        link: 'https://studio.test/?playbook=sales&goal=paying-customers&per=experiment-10',
      },
      {
        title: 'experiment-11',
        word: 'Brought a customer',
        value: 1,
        at: iso(savedAt + hour + 60_000),
        link: 'https://studio.test/?playbook=sales&goal=paying-customers&per=experiment-11',
      },
    ]);
  });

  it('names a calendar week and month by their start, and a goal judged as a whole by its statement', async () => {
    const summary = await summaryBookOf();
    await windowsEnded(summary);
    await performedAt(summary.work, friday);
    const input = inputOf(summary.starts[0]);

    expect(input['detail']).toBe(
      [
        'No result: November 2026',
        'No result: Bring in paying customers through my experiments.',
        'No result: Week of November 9',
      ].join('\n'),
    );
    expect(input['counts']).toEqual({ passed: 0, failed: 0, overdue: 0, no_result: 3 });
  });
});

const lateThing = `assessments/${assessmentIdOf({ goal: weekly.id, per: 'experiment-late' })}`;

async function fridaySeen(summary: SummaryBook): Promise<void> {
  await performedAt(summary.work, friday);
  const started = await summary.book.runStarted(fridayRun(), summaryReference());
  const seen = noticesSeenOf(summary.book.ledger, () => friday);
  const batch = await Effect.runPromise(seen.batchOf({ playbook: sales, record: started }));
  await Effect.runPromise(Effect.forEach(batch.deliveries, ({ deliver }) => deliver));
}

async function linesAcrossTwoFridays(type: string, data: Schema.Json, recordedAt: number) {
  const summary = await summaryBookOf();
  await summary.book.append(
    lateThing,
    'goal_assessment_opened',
    {
      goal: weekly.id,
      goals_version: 1,
      per: { id: 'experiment-late' },
      rule: { settles: 'on_crossing', target: { at_least: 1 } },
      milestones: [],
    },
    { at: iso(savedAt), by: 'playbook:sales' },
  );
  await fridaySeen(summary);
  await summary.book.append(lateThing, type, data, { at: iso(recordedAt), by: 'playbook:sales' });
  await performedAt(summary.work, friday + week);
  return summary.starts.map((start) => linesOf(start).length);
}

describe('a change recorded after the summary that its named time falls before', () => {
  it('is in the next summary, as a crossing from a run that ended just before the summary', async () => {
    const verdict = { verdict: 'passed', at: iso(friday - 2_000), by: 'crossing', told: 'summary' };

    expect(await linesAcrossTwoFridays('goal_assessed', verdict, friday + 2_000)).toEqual([0, 1]);
  });

  it('is in the next summary, as an overdue the clock judged late after downtime', async () => {
    const overdue = { since: iso(friday - 8 * hour), told: 'summary' };

    expect(await linesAcrossTwoFridays('goal_overdue', overdue, friday + hour)).toEqual([0, 1]);
  });
});
