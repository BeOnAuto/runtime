import { describe } from 'vitest';

import { identityBehaviour } from '../testing/identity-behaviour.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

describe.skipIf(server === '')('an installation identity shared by PostgreSQL replicas', () => {
  identityBehaviour(() => postgresqlDatabase(server));
});
