import { structureOfThePostgreSQLDatabase } from '@on.auto/ledger/database-structure';
import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { postgresqlDatabasesOn } from '@on.auto/ledger/postgresql-testing';
import { describe } from 'vitest';

import { chatReadsBehaviour } from './chat-arrivals-behaviour.ts';
import { chatDatabaseBehaviour, rowsOnTheLedger } from './chat-database-behaviour.ts';
import { chatLinksBehaviour } from './chat-links-behaviour.ts';
import { chatRowsBehaviour, type ChatRowsEntry } from './chat-rows-behaviour.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase } = postgresqlDatabasesOn(server);

const onPostgreSQL: ChatRowsEntry = {
  name: 'on PostgreSQL',
  rowsOf: async () => rowsOnTheLedger(postgresqlLedgerLayer({ pools: plainPoolsOn(await anEmptyDatabase()) })),
};

describe.skipIf(skipped)(`the chat tables on PostgreSQL${notice}`, () => {
  chatRowsBehaviour(onPostgreSQL);
  chatReadsBehaviour(onPostgreSQL);
  chatLinksBehaviour(onPostgreSQL);
  chatDatabaseBehaviour({
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
