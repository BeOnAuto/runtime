import { describe } from 'vitest';

import { executorOn } from '../content/postgresql-content.ts';
import { catchUpReadsBehaviour } from '../projection-catch-up/catch-up-reads-behaviour.ts';
import { keyedFillBehaviour, type FillEntry } from '../projections/keyed-fill-behaviour.ts';
import { postgresqlConnected, postgresqlDatabasesOn } from '../testing/postgresql-databases.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './postgresql-ledger.ts';
import { postgresqlProjectionsOf } from './postgresql-projections.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

const executedOn: FillEntry['executedOn'] = async (database, work) =>
  work(executorOn(await postgresqlConnected(database)));

const onPostgreSQL: FillEntry = {
  aDatabase,
  executedOn,
  ledgerOn: (database, { projections = [], holders }) =>
    postgresqlLedgerLayer({
      pools: plainPoolsOn(database),
      projections,
      ...(holders === undefined ? {} : { holders }),
    }),
  projectionsOf: postgresqlProjectionsOf,
};

describe.skipIf(skipped)(`The fills of a ledger on PostgreSQL${notice}`, () => {
  keyedFillBehaviour(onPostgreSQL);
  catchUpReadsBehaviour(onPostgreSQL);
});
