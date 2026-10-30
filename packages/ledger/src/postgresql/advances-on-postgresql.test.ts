import { randomUUID } from 'node:crypto';

import { topicFacts, topicRows } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { openLedgerWith } from '../testing/open-ledger.ts';
import { until } from '../testing/until.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function connected(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

async function queried(database: string, statement: string): Promise<readonly unknown[]> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    const { rows } = await client.query<Readonly<Record<string, unknown>>>(statement);
    return rows;
  } finally {
    await client.end();
  }
}

async function aDatabase(): Promise<string> {
  const name = `advances_${randomUUID().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await queried(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

const waitingOnALock =
  "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'";

async function untilAWriteWaitsOnALock(database: string): Promise<void> {
  await until(async () => {
    expect(await queried(database, waitingOnALock)).toEqual([{ waiting: 1 }]);
  });
}

describe.skipIf(skipped)(`A fold beside an advance of the same row on PostgreSQL${notice}`, () => {
  it('leaves the columns the advance wrote, though the fold read the row before the advance committed', async () => {
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
    const advancing = await connected(database);
    await advancing.query('BEGIN');
    await advancing.query("UPDATE topics_2 SET open = false, next_at = NULL, due_at = NULL WHERE row_key = 'spring'");

    const folding = Effect.runPromise(
      ledger.execute('playbook/acme/alpha/notes/n1', topicFacts, [
        { type: 'topic_noted', data: { topic: 'spring', note: 'during' } },
      ]),
    );
    await untilAWriteWaitsOnALock(database);
    await advancing.query('COMMIT');
    await folding;

    expect(
      await queried(database, "SELECT note, open, next_at, due_at FROM topics_2 WHERE row_key = 'spring'"),
    ).toEqual([{ note: 'during', open: false, next_at: null, due_at: null }]);
  });
});
