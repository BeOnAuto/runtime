import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { Schema } from 'effect';
import { Client } from 'pg';
import { onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { answerShapesOn, type ProjectionStore } from '../testing/interaction-servers/answer-shapes.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const decodeNames = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })));

function namesIn(rows: unknown): readonly string[] {
  return decodeNames(rows).map(({ name }) => name);
}

function tablesInSQLite(file: string, projection: string): readonly string[] {
  const database = new DatabaseSync(file);
  try {
    return namesIn(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB ? ORDER BY name")
        .all(`${projection}_*`),
    );
  } finally {
    database.close();
  }
}

function droppedInSQLite(file: string, table: string): void {
  const database = new DatabaseSync(file);
  try {
    database.exec(`DROP TABLE ${table}`);
  } finally {
    database.close();
  }
}

function onSQLite(): Promise<ProjectionStore> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve({
    environment: { LEDGER_FILE: ledger.fileName },
    ledgerKeeping: (projection) => ledgerLayer({ fileName: ledger.fileName, projections: [projection] }),
    tablesOf: (projection) => Promise.resolve(tablesInSQLite(ledger.fileName, projection)),
    dropTable: (table) => {
      droppedInSQLite(ledger.fileName, table);
      return Promise.resolve();
    },
  });
}

async function namesAnswered(
  url: string,
  statement: string,
  values: readonly string[] = [],
): Promise<readonly string[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return namesIn((await client.query(statement, [...values])).rows);
  } finally {
    await client.end();
  }
}

async function onPostgreSQL(): Promise<ProjectionStore> {
  const name = `answer_shapes_${randomUUID().replaceAll('-', '')}`;
  await namesAnswered(postgresql, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await namesAnswered(postgresql, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  const url = database.href;
  return {
    environment: { LEDGER_FILE: '', DATABASE_URL: url, SECRETS_KEY: secretsKey },
    ledgerKeeping: (projection) =>
      postgresqlLedgerLayer({
        pools: plainPoolsOn(url),
        projections: [projection],
      }),
    tablesOf: (projection) =>
      namesAnswered(url, 'SELECT tablename AS name FROM pg_tables WHERE tablename ~ $1 ORDER BY tablename', [
        `^${projection}_[0-9]+$`,
      ]),
    dropTable: async (table) => {
      await namesAnswered(url, `DROP TABLE ${table}`);
    },
  };
}

answerShapesOn([
  { store: 'SQLite', skipped: false, aStore: onSQLite },
  { store: `PostgreSQL${notice}`, skipped: postgresql === '', aStore: onPostgreSQL },
]);
