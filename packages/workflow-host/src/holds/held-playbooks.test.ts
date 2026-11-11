import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { describe, onTestFinished } from 'vitest';

import { heldPlaybookSuite } from '../reaction-testing/held-playbook-suite.ts';
import { heldWakeSuite } from '../reaction-testing/held-wake-suite.ts';
import { unreadableFactSuite } from '../reaction-testing/unreadable-fact-suite.ts';
import { onPostgreSQLAt, onSQLite, type SettingsOf } from '../testing/host-files.ts';

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

describe('a playbook whose follower is held at a record, on SQLite', () => {
  heldPlaybookSuite(onSQLite);
  unreadableFactSuite(onSQLite);
  heldWakeSuite(onSQLite);
});

describe.skipIf(server === '')(`a playbook whose follower is held at a record, on PostgreSQL${notice}`, () => {
  heldPlaybookSuite(onPostgreSQL);
  unreadableFactSuite(onPostgreSQL);
  heldWakeSuite(onPostgreSQL);
});
