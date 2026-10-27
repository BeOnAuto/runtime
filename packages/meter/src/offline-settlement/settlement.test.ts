import { describe } from 'vitest';

import { settlementBehaviour } from '../offline-testing/settlement-behaviour.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

describe('SQLite offline dispatch and release', () => {
  settlementBehaviour(sqliteDatabase);
});
const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';
describe.skipIf(server === '')('PostgreSQL offline dispatch and release', () => {
  settlementBehaviour(() => postgresqlDatabase(server));
});
