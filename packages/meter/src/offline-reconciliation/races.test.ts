import { describe } from 'vitest';

import { reportRaces } from '../offline-testing/report-races.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

describe('SQLite report races', () => {
  reportRaces(sqliteDatabase);
});
const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';
describe.skipIf(server === '')('PostgreSQL report races', () => {
  reportRaces(() => postgresqlDatabase(server));
});
