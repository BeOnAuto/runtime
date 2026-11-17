import { randomUUID } from 'node:crypto';

import { Function } from 'effect';
import { Client } from 'pg';
import { afterAll, onTestFinished } from 'vitest';

import { plainPoolsOn, postgresqlLedgerOpened } from '../postgresql/postgresql-ledger.ts';

export type PostgreSQLRow = Readonly<Record<string, unknown>>;

export interface PostgreSQLDatabase {
  readonly name: string;
  readonly url: string;
  readonly remove: () => Promise<void>;
}

export interface PostgreSQLDatabases {
  readonly skipped: boolean;
  readonly notice: string;
  readonly anEmptyDatabase: () => Promise<string>;
  readonly aMigratedDatabase: () => Promise<string>;
}

export const postgresqlSkipNotice =
  ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it';

export async function postgresqlConnected(database: string): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

export async function postgresqlQueried(
  database: string,
  statement: string,
  values: readonly unknown[] = [],
): Promise<readonly PostgreSQLRow[]> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    return (await client.query<PostgreSQLRow>(statement, [...values])).rows;
  } finally {
    await client.end();
  }
}

export async function postgresqlDatabaseOn(server: string, template?: PostgreSQLDatabase): Promise<PostgreSQLDatabase> {
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  await postgresqlQueried(
    server,
    `CREATE DATABASE ${name}${template === undefined ? '' : ` TEMPLATE ${template.name}`}`,
  );
  const url = new URL(server);
  url.pathname = `/${name}`;
  return {
    name,
    url: url.href,
    remove: async () => {
      await postgresqlQueried(server, `DROP DATABASE ${name} WITH (FORCE)`);
    },
  };
}

async function migratedTemplateOn(server: string): Promise<PostgreSQLDatabase> {
  const template = await postgresqlDatabaseOn(server);
  const { store } = postgresqlLedgerOpened({
    pools: plainPoolsOn(template.url),
    reportLostConnection: Function.constVoid,
  });
  await store.migrate();
  await store.close();
  return template;
}

export function postgresqlDatabasesOn(server: string): PostgreSQLDatabases {
  const skipped = server === '';
  const kept: { template?: Promise<PostgreSQLDatabase> } = {};
  afterAll(async () => {
    await (await kept.template)?.remove();
  });
  const droppedAfterTheTest = async (template?: PostgreSQLDatabase) => {
    const database = await postgresqlDatabaseOn(server, template);
    onTestFinished(database.remove);
    return database.url;
  };
  const migratedTemplate = (): Promise<PostgreSQLDatabase> => {
    kept.template ??= migratedTemplateOn(server);
    return kept.template;
  };
  return {
    skipped,
    notice: skipped ? postgresqlSkipNotice : '',
    anEmptyDatabase: () => droppedAfterTheTest(),
    aMigratedDatabase: async () => droppedAfterTheTest(await migratedTemplate()),
  };
}
