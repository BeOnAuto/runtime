import { describe } from 'vitest';

import { goalNoticeBehaviour } from '../meter-testing/goal-notice-behaviour.ts';
import { postgresqlLedger, sqliteLedger } from '../testing/ledgers.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

describe('goal notices on SQLite', () => {
  goalNoticeBehaviour(() => Promise.resolve(sqliteLedger()));
});

describe.skipIf(server === '')('goal notices on PostgreSQL', () => {
  goalNoticeBehaviour(() => postgresqlLedger(server));
});
