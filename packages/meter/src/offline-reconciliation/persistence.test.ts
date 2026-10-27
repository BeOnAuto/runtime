import { describe } from 'vitest';

import { reportPersistenceBehaviour } from '../offline-testing/report-persistence.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

describe('SQLite report atomicity', () => {
  reportPersistenceBehaviour(sqliteDatabase);
});
const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';
describe.skipIf(server === '')('PostgreSQL report atomicity', () => {
  reportPersistenceBehaviour(() => postgresqlDatabase(server));
});
