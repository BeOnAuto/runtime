import { describe } from 'vitest';

import { licenseClientBehaviour } from '../testing/license-client-behaviour.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

describe.skipIf(server === '')('the durable license client on PostgreSQL', () => {
  licenseClientBehaviour(() => postgresqlDatabase(server));
});
