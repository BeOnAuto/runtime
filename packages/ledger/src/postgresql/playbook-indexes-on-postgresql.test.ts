import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { thePlaybookIndexes } from '../postgresql-reads/index-checks.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlDatabasesOn, postgresqlQueried } from '../testing/postgresql-databases.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

async function aLedgerOnItsOwnDatabase(): Promise<string> {
  const database = await aDatabase();
  const { dispose } = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
  onTestFinished(dispose);
  return database;
}

async function anAppendLeftOpen(database: string): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  await client.query(
    `SELECT success FROM emt_append_to_stream(
      ARRAY['late-1'], ARRAY[$1::jsonb], ARRAY[$3::jsonb], ARRAY['1'], ARRAY['noted'], ARRAY['E'], $2, 'playbook', 0, 'emt:default')`,
    [
      { json: JSON.stringify({ detail: 'late' }) },
      'playbook/acme/alpha/late',
      { at: '2026-10-05T09:00:00.000Z', by: 'tester' },
    ],
  );
  return client;
}

describe.skipIf(skipped)(`The playbook's indexes on PostgreSQL${notice}`, () => {
  it('are created when the ledger opens, once however often it opens', async () => {
    const database = await aDatabase();
    const first = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    await first.dispose();
    const second = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    await second.dispose();

    expect(
      await postgresqlQueried(
        database,
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('emt_messages', 'emt_streams') AND indexname LIKE 'ledger%' ORDER BY indexname",
      ),
    ).toEqual(thePlaybookIndexes);
  });

  it('are found, not created again, by a start that an append left open does not hold up', async () => {
    const database = await aLedgerOnItsOwnDatabase();
    const open = await anAppendLeftOpen(database);

    const started = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    await started.dispose();
    await open.query('COMMIT');

    expect(
      await postgresqlQueried(
        database,
        "SELECT count(*)::int AS indexes FROM pg_indexes WHERE tablename IN ('emt_messages', 'emt_streams') AND indexname LIKE 'ledger%'",
      ),
    ).toEqual([{ indexes: 7 }]);
  });
});
