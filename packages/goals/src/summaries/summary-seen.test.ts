import { Conflict } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { summaryRunIdOf } from '../assessments/assessment-identity.ts';
import { performedAt, sales } from '../notices/notice-samples.ts';
import { noticesSeenOf } from '../notices/notices-seen.ts';
import { summaryRecorded, summarySeenIn } from './summary-ledger.ts';
import { friday, fridayRun, iso, summaryBookOf, summaryReference, weekly } from './summary-samples.ts';

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
