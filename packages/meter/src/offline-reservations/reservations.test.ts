import { describe } from 'vitest';

import { reservationBehaviour } from '../offline-testing/reservation-behaviour.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

describe('SQLite offline reservations', () => {
  reservationBehaviour(sqliteDatabase);
});
const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';
describe.skipIf(server === '')('PostgreSQL offline reservations', () => {
  reservationBehaviour(() => postgresqlDatabase(server));
});
