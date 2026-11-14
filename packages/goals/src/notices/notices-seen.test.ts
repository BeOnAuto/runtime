import { Conflict } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessment, experiments, monday, noticeBookOf, runOf, sales } from './notice-samples.ts';
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
    const book = noticeBookOf();
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
      { assessment, change: 'overdue', run: runOf('overdue') },
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
