import { describe } from 'vitest';

import { selfHostedBehaviour } from '../self-hosted-testing/behaviour.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

describe('composed SQLite self-hosted meter', () => {
  selfHostedBehaviour(sqliteDatabase);
});
const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';
describe.skipIf(server === '')('composed PostgreSQL self-hosted meter', () => {
  selfHostedBehaviour(() => postgresqlDatabase(server));
});
