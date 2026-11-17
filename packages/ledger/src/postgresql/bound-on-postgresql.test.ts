import { describe, expect, it, onTestFinished } from 'vitest';

import { postgresqlMostBoundValues } from '../connection/bound-values.ts';
import { openConnectionWith } from '../testing/open-ledger.ts';
import { postgresqlDatabasesOn } from '../testing/postgresql-databases.ts';
import { valuesListOf } from '../testing/values-list.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

describe.skipIf(skipped)(`The most values a statement binds on the PostgreSQL host${notice}`, () => {
  it('are 65,535, which PostgreSQL takes in one statement, refusing one more', async () => {
    const database = await aDatabase();
    const { connection, dispose } = await openConnectionWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    onTestFinished(dispose);

    expect(connection.mostBoundValues).toBe(postgresqlMostBoundValues);
    expect(await connection.read(valuesListOf(postgresqlMostBoundValues))).toEqual([
      { counted: String(postgresqlMostBoundValues) },
    ]);
    await expect(connection.read(valuesListOf(postgresqlMostBoundValues + 1))).rejects.toBeInstanceOf(Error);
  });
});
