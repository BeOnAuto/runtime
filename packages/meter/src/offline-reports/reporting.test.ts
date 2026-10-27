import { describe } from 'vitest';

import { reportBehaviour } from '../offline-testing/report-behaviour.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

describe('SQLite signed offline reports', () => {
  reportBehaviour(sqliteDatabase);
});
const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';
describe.skipIf(server === '')('PostgreSQL signed offline reports', () => {
  reportBehaviour(() => postgresqlDatabase(server));
});
