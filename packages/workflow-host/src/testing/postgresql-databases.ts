import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, onTestFinished } from 'vitest';

import { hostDatabaseOpenedOn } from '../ledger-testing/ledger-connections.ts';
import { onPostgreSQLAt } from './host-files.ts';

const server = [process.env['LEDGER_TEST_POSTGRESQL_URL']].join('');

const withoutPostgreSQL = server === '';

type DatabasesOnPostgreSQL = () => Promise<string>;

async function administered(statement: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

function urlOf(name: string): string {
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

function aName(kind: string): string {
  return `workflow_host_${kind}${randomUUID().replaceAll('-', '')}`;
}

async function aMigratedTemplate(): Promise<string> {
  const name = aName('template_');
  await administered(`CREATE DATABASE ${name}`);
  const migrated = await hostDatabaseOpenedOn(onPostgreSQLAt(urlOf(name)));
  await migrated.close();
  await administered(`ALTER DATABASE ${name} WITH IS_TEMPLATE true`);
  return name;
}

async function aDatabaseFrom(template: string): Promise<string> {
  const name = aName('');
  await administered(`CREATE DATABASE ${name} TEMPLATE ${template}`);
  await administered(`ALTER DATABASE ${name} SET synchronous_commit = off`);
  onTestFinished(async () => {
    await administered(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  return urlOf(name);
}

export function describeOnPostgreSQL(title: string, body: (aDatabase: DatabasesOnPostgreSQL) => void): void {
  describe.skipIf(withoutPostgreSQL)(`${title}, on the PostgreSQL server LEDGER_TEST_POSTGRESQL_URL names`, () => {
    const template = { name: '' };
    beforeAll(async () => {
      template.name = await aMigratedTemplate();
    });
    afterAll(async () => {
      await administered(`ALTER DATABASE ${template.name} WITH IS_TEMPLATE false`);
      await administered(`DROP DATABASE ${template.name} WITH (FORCE)`);
    });
    body(() => aDatabaseFrom(template.name));
  });
}
