import { describe } from 'vitest';

import { deadlineRaceBehaviour, movingClockBehaviour } from '../offline-testing/time-races.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

describe('SQLite admission clock fences', () => {
  movingClockBehaviour(sqliteDatabase);
  deadlineRaceBehaviour(sqliteDatabase);
});
const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';
describe.skipIf(server === '')('PostgreSQL admission clock fences', () => {
  movingClockBehaviour(() => postgresqlDatabase(server));
  deadlineRaceBehaviour(() => postgresqlDatabase(server));
});
