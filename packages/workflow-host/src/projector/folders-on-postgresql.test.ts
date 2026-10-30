import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { describe, onTestFinished } from 'vitest';

import { foldersSuite } from '../folder-testing/folders-suite.ts';
import { laggingSuite } from '../folder-testing/lagging-suite.ts';
import { onPostgreSQLAt, type SettingsOf } from '../testing/host-files.ts';

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
  const name = `workflow_host_${randomUUID().replaceAll('-', '')}`;
  await administered(`CREATE DATABASE ${name}`);
  await administered(`ALTER DATABASE ${name} SET synchronous_commit = off`);
  onTestFinished(async () => {
    await administered(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return onPostgreSQLAt(database.href);
};

describe.skipIf(skipped)(`the folders of the projector on PostgreSQL${notice}`, () => {
  foldersSuite(onPostgreSQL);
  laggingSuite(onPostgreSQL);
});
