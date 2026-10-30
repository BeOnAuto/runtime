import { randomUUID } from 'node:crypto';

import { Client, Pool } from 'pg';
import { describe, onTestFinished } from 'vitest';

import { datasetBoundSuite } from '../dataset-testing/dataset-bound-suite.ts';
import { datasetEdgesSuite } from '../dataset-testing/dataset-edges-suite.ts';
import { datasetLifecycleSuite } from '../dataset-testing/dataset-lifecycle-suite.ts';
import type { SettingsOf } from '../dataset-testing/dataset-stores.ts';
import { datasetFoldingSuite } from '../dataset-testing/dataset-suite.ts';
import { datasetWritesSuite } from '../dataset-testing/dataset-writes-suite.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function administered(statement: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

const onPostgreSQL: SettingsOf = async () => {
  const name = `prediction_${randomUUID().replaceAll('-', '')}`;
  await administered(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administered(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return { store: 'postgresql', pools: ({ max }) => new Pool({ connectionString: database.href, max }) };
};

describe.skipIf(skipped)(`the datasets of prediction functions on PostgreSQL${notice}`, () => {
  datasetFoldingSuite(onPostgreSQL);
  datasetLifecycleSuite(onPostgreSQL);
  datasetEdgesSuite(onPostgreSQL);
  datasetWritesSuite(onPostgreSQL);
  datasetBoundSuite(onPostgreSQL);
});
