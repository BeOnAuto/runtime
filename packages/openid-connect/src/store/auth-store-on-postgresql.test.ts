import { structureOfThePostgreSQLDatabase } from '@on.auto/ledger/database-structure';
import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { postgresqlDatabasesOn } from '@on.auto/ledger/postgresql-testing';
import { describe } from 'vitest';

import { authFloorBehaviour } from './auth-floor-behaviour.ts';
import { authStoreBehaviour } from './auth-store-behaviour.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase } = postgresqlDatabasesOn(server);

describe.skipIf(skipped)(`the sign-in's store on PostgreSQL${notice}`, () => {
  authStoreBehaviour({
    name: 'on PostgreSQL',
    aDatabase: async () => {
      const url = await anEmptyDatabase();
      return () => postgresqlLedgerLayer({ pools: plainPoolsOn(url) });
    },
  });
  authFloorBehaviour({
    name: 'on PostgreSQL',
    aDatabase: async () => {
      const url = await anEmptyDatabase();
      return {
        ledgerOn: () => postgresqlLedgerLayer({ pools: plainPoolsOn(url) }),
        structure: () => structureOfThePostgreSQLDatabase(url),
      };
    },
  });
});
