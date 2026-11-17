import type { Ledger } from '@on.auto/operations';
import { topicFacts, topicRows } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlConnected, postgresqlDatabasesOn, postgresqlQueried } from '../testing/postgresql-databases.ts';
import { until } from '../testing/until.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

const waitingOnALock =
  "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'";

async function untilWritesWaitOnALock(database: string, waiting = 1): Promise<void> {
  await until(
    () => postgresqlQueried(database, waitingOnALock),
    (rows) => JSON.stringify(rows) === JSON.stringify([{ waiting }]),
  );
}

describe.skipIf(skipped)(`A fold beside an advance of the same row on PostgreSQL${notice}`, () => {
  it('leaves the columns the advance wrote, the fold waiting for the advance to commit before it reads the row', async () => {
    const database = await aDatabase();
    const { ledger, dispose } = await openLedgerWith(
      postgresqlLedgerLayer({ pools: plainPoolsOn(database), projections: [topicRows] }),
    );
    onTestFinished(dispose);
    await Effect.runPromise(
      ledger.execute('playbook/acme/alpha/runs/r1', topicFacts, [
        { type: 'topic_opened', data: { topic: 'spring', at: 1000 } },
      ]),
    );
    const advancing = await postgresqlConnected(database);
    await advancing.query('BEGIN');
    await advancing.query("UPDATE topics_2 SET open = false, next_at = NULL, due_at = NULL WHERE row_key = 'spring'");

    const folding = Effect.runPromise(
      ledger.execute('playbook/acme/alpha/notes/n1', topicFacts, [
        { type: 'topic_noted', data: { topic: 'spring', note: 'during' } },
      ]),
    );
    await untilWritesWaitOnALock(database);
    await advancing.query('COMMIT');
    await folding;

    expect(
      await postgresqlQueried(database, "SELECT note, open, next_at, due_at FROM topics_2 WHERE row_key = 'spring'"),
    ).toEqual([{ note: 'during', open: false, next_at: null, due_at: null }]);
  });
});

async function aLedgerOfTopics(): Promise<{ readonly database: string; readonly ledger: Ledger['Service'] }> {
  const database = await aDatabase();
  const { ledger, dispose } = await openLedgerWith(
    postgresqlLedgerLayer({ pools: plainPoolsOn(database), projections: [topicRows] }),
  );
  onTestFinished(dispose);
  await Effect.runPromise(
    ledger.execute('playbook/acme/alpha/runs/r1', topicFacts, [
      { type: 'topic_opened', data: { topic: 'spring', at: 1000 } },
    ]),
  );
  return { database, ledger };
}

async function aRowHeld(database: string): ReturnType<typeof postgresqlConnected> {
  const holding = await postgresqlConnected(database);
  await holding.query('BEGIN');
  await holding.query("SELECT 1 FROM topics_2 WHERE row_key = 'spring' FOR UPDATE");
  return holding;
}

const springOf = "SELECT note, next_at FROM topics_2 WHERE row_key = 'spring'";

describe.skipIf(skipped)(`Two appends that fold into one row at once on PostgreSQL${notice}`, () => {
  it('fold one after the other, each from the row the other left, so neither is lost', async () => {
    const { database, ledger } = await aLedgerOfTopics();
    const holding = await aRowHeld(database);

    const noting = Effect.runPromise(
      ledger.execute('playbook/acme/alpha/notes/n1', topicFacts, [
        { type: 'topic_noted', data: { topic: 'spring', note: 'during' } },
      ]),
    );
    const opening = Effect.runPromise(
      ledger.execute('playbook/acme/alpha/runs/r2', topicFacts, [
        { type: 'topic_opened', data: { topic: 'spring', at: 2000 } },
      ]),
    );
    await untilWritesWaitOnALock(database, 2);
    await holding.query('COMMIT');
    await Promise.all([noting, opening]);

    expect(await postgresqlQueried(database, springOf)).toEqual([{ note: 'during', next_at: '7000' }]);
  });
});

describe.skipIf(skipped)(
  `A scrub beside an append that folds into the row it folds again on PostgreSQL${notice}`,
  () => {
    it('leaves the row folded from the scrubbed fact and the appended one, whichever folds first', async () => {
      const { database, ledger } = await aLedgerOfTopics();
      await Effect.runPromise(
        ledger.execute('playbook/acme/alpha/notes/n1', topicFacts, [
          { type: 'topic_noted', data: { topic: 'spring', note: 'call me on 0123' } },
        ]),
      );
      const holding = await aRowHeld(database);

      const scrubbing = Effect.runPromise(
        ledger.scrubFact('playbook/acme/alpha/notes/n1', 1, {
          eventSchema: topicFacts.eventSchema,
          data: { topic: 'spring', note: 'a note was erased' },
          erasure: { type: 'topic_noted', data: { topic: 'erased', note: 'a note was erased' } },
          context: { at: '2026-10-06T09:00:00.000Z', by: 'eraser' },
        }),
      );
      const opening = Effect.runPromise(
        ledger.execute('playbook/acme/alpha/runs/r2', topicFacts, [
          { type: 'topic_opened', data: { topic: 'spring', at: 2000 } },
        ]),
      );
      await untilWritesWaitOnALock(database, 2);
      await holding.query('COMMIT');
      await Promise.all([scrubbing, opening]);

      expect(await postgresqlQueried(database, springOf)).toEqual([{ note: 'a note was erased', next_at: '7000' }]);
    });
  },
);
