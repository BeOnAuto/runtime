import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { describe, onTestFinished } from 'vitest';

import { onPostgreSQLAt, onSQLite, type SettingsOf } from '../testing/host-files.ts';
import { lostCancelSuite } from '../waiting-testing/lost-cancel-suite.ts';
import { endedRunSuite } from '../waiting-testing/resumed-cancels.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  server === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

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
  const name = `workflow_host_${randomUUID().replaceAll('-', '')}`;
  await administered(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administered(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return onPostgreSQLAt(database.href);
};

describe('the cancels a follower passed over, on SQLite', () => {
  lostCancelSuite(onSQLite);
  endedRunSuite(onSQLite);
});

describe.skipIf(server === '')(`the cancels a follower passed over, on PostgreSQL${notice}`, () => {
  lostCancelSuite(onPostgreSQL);
  endedRunSuite(onPostgreSQL);
});
