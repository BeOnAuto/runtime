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

async function queried(database: string, statement: string, values: readonly unknown[] = []): Promise<unknown[]> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    const { rows } = await client.query<Readonly<Record<string, unknown>>>(statement, [...values]);
    return rows;
  } finally {
    await client.end();
  }
}

async function administered(statement: string): Promise<void> {
  await queried(server, statement);
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

const place = {
  playbook_key: 'playbook/acme/sales/',
  cursor: 'cursor-of-the-place',
  delivered: '["trigger_starts","close"]',
  attempts: 3,
  waiting: 0,
  checked: '7',
};

const places = 'SELECT * FROM workflow_followed_playbooks';

describe.skipIf(skipped)(
  `the place a follower kept in a playbook, in a PostgreSQL database made at the floor${notice}`,
  () => {
    it('reads as it did once every step carried the database forward, with no hold of the follower', async () => {
      const database = await aDatabase();
      await aPostgreSQLDatabaseFrom(theFloor(), database);
      await queried(
        database,
        'INSERT INTO workflow_followed_playbooks (playbook_key, cursor, delivered, attempts, waiting, checked) VALUES ($1, $2, $3, $4, $5, $6)',
        Object.values(place),
      );

      const before = await queried(database, places);
      const after = await queried(await openedOn(database), places);

      expect([before, after]).toEqual([
        [place],
        [{ ...place, held_since: null, held_until: null, holds: 0, held_for: null }],
      ]);
    });
  },
);

describe.skipIf(skipped)(
  `a PostgreSQL database made at the floor whose first opening ended before the workflow host made its tables${notice}`,
  () => {
    it('is carried forward by every step all the same, each step making the table it changes, and opens as a new one', async () => {
      const carried = await aDatabase();
      await aPostgreSQLDatabaseFrom(theFloor(), carried);
      const [{ tables }] = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ tables: Schema.String })]))(
        await queried(
          carried,
          "SELECT string_agg(tablename, ', ') AS tables FROM pg_tables WHERE schemaname = current_schema() AND tablename LIKE 'workflow\\_%'",
        ),
      );
      await queried(carried, `DROP TABLE ${tables}`);

      const [made, carriedForward] = [
        await structureOfThePostgreSQLDatabase(await openedOn(await aDatabase())),
        await structureOfThePostgreSQLDatabase(await openedOn(carried)),
      ];

      expect(carriedForward).toEqual(made);
    });
  },
);

describe.skipIf(skipped)(`the PostgreSQL database made at the floor${notice}`, () => {
  it('is made as database-floor-postgresql.json describes it, the tables and indexes of the layout over those the store makes itself, in the layout of the floor', async () => {
    const [made, storeAlone] = [await aDatabase(), await aDatabase()];
    await aPostgreSQLDatabaseOfTheStore(storeAlone);

    await aPostgreSQLDatabaseFrom(theFloor(), made);

    expect(theFloor().layout).toBe(ledgerLayoutFloor);
    expect(await postgresqlLayoutDumpOf(made, storeAlone)).toEqual(theFloor());
  });
});
