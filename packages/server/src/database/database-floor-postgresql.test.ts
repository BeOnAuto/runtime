import { readFileSync } from 'node:fs';

import {
  DatabaseDumpSchema,
  aPostgreSQLDatabaseFrom,
  aPostgreSQLDatabaseOfTheStore,
  postgresqlLayoutDumpOf,
  structureOfThePostgreSQLDatabase,
} from '@on.auto/ledger/database-structure';
import { ledgerLayoutFloor } from '@on.auto/ledger/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { servingReasoning } from '../testing/servers/reasoning-server.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

function theFloor() {
  return Schema.decodeUnknownSync(Schema.fromJsonString(DatabaseDumpSchema))(
    readFileSync(new URL('database-floor-postgresql.json', import.meta.url), 'utf8'),
  );
}

async function administered(statement: string): Promise<void> {
  const client = new Client({ connectionString: server });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function aDatabase(): Promise<string> {
  const name = `server_${crypto.randomUUID().replaceAll('-', '')}`;
  await administered(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administered(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

async function openedOn(database: string): Promise<string> {
  const opened = await servingReasoning([], { LEDGER_FILE: '', DATABASE_URL: database, SECRETS_KEY: secretsKey });
  await opened.stop();
  return database;
}

describe.skipIf(skipped)(`the layout of the database the server opens in PostgreSQL${notice}`, () => {
  it('is, in the columns, types, nullability, defaults, primary keys and indexes of every table, the layout a database made at the floor, database-floor-postgresql.json, is carried forward to by every step', async () => {
    const carried = await aDatabase();
    await aPostgreSQLDatabaseFrom(theFloor(), carried);

    const [made, carriedForward] = [
      await structureOfThePostgreSQLDatabase(await openedOn(await aDatabase())),
      await structureOfThePostgreSQLDatabase(await openedOn(carried)),
    ];

    expect(
      carriedForward,
      'A PostgreSQL database made at the floor and carried forward by every step differs from a new one: a step leaves the database as a new database of its layout would be, in the statement it runs on PostgreSQL',
    ).toEqual(made);
  });
});

describe.skipIf(skipped)(`the PostgreSQL database made at the floor${notice}`, () => {
  it('is made as database-floor-postgresql.json describes it, the tables and indexes of the layout over those the store makes itself, in the layout of the floor', async () => {
    const [made, storeAlone] = [await aDatabase(), await aDatabase()];
    await aPostgreSQLDatabaseOfTheStore(storeAlone);

    await aPostgreSQLDatabaseFrom(theFloor(), made);

    expect(theFloor().layout).toBe(ledgerLayoutFloor);
    expect(await postgresqlLayoutDumpOf(made, storeAlone)).toEqual(theFloor());
  });
});
