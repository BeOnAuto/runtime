import { postgresqlDatabasesOn } from '@on.auto/ledger/postgresql-testing';
import { Pool } from 'pg';
import { describe } from 'vitest';

import { datasetBoundSuite } from '../dataset-testing/dataset-bound-suite.ts';
import type { SettingsOf } from '../dataset-testing/dataset-stores.ts';
import { datasetWritesSuite } from '../dataset-testing/dataset-writes-suite.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase } = postgresqlDatabasesOn(server);

const onPostgreSQL: SettingsOf = async () => {
  const database = await anEmptyDatabase();
  return { store: 'postgresql', pools: ({ max }) => new Pool({ connectionString: database, max }) };
};

describe.skipIf(skipped)(`the datasets of prediction functions on PostgreSQL${notice}`, () => {
  datasetWritesSuite(onPostgreSQL);
  datasetBoundSuite(onPostgreSQL);
});
