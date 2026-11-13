import { randomUUID } from 'node:crypto';

import { Conflict } from '@on.auto/operations';
import { Function, Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { EncodedEvent, LedgerStore } from '../index.ts';
import { at } from '../multi-stream/multi-stream-cases.ts';
import { plainPoolsOn, postgresqlEventStore } from '../postgresql/postgresql-ledger.ts';
import { until } from '../testing/until.ts';
import type { DefinitionNames } from './definition-names.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

async function connected(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

async function aDatabase(): Promise<string> {
  const name = `names_${randomUUID().replaceAll('-', '')}`;
  const admin = await connected(server);
  await admin.query(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    const dropping = new Client({ connectionString: server });
    await dropping.connect();
    await dropping.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await dropping.end();
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

const Claimed = Schema.Struct({ definition: Schema.String, name: Schema.String });

const claimedBy = Schema.decodeUnknownSync(Claimed);

const alpha = 'playbook/acme/alpha/';

const sharingOneStream: DefinitionNames = {
  types: ['claimed'],
  definitionKeyOf: ({ data }) => `definition/acme/${claimedBy(data).definition}/`,
  nameAfter: (_held, { data }) => ({
    playbookKey: alpha,
    definitionType: 'reasoning',
    name: claimedBy(data).name,
    status: 'active',
    hasTriggers: false,
  }),
  takenBy: () => new Conflict({ detail: 'The name is taken', kind: 'taken' }),
};

function claim(definition: string, name: string): EncodedEvent {
  return { type: 'claimed', data: { definition, name } };
}

async function aStoreOn(database: string): Promise<LedgerStore> {
  const store = postgresqlEventStore({
    pools: plainPoolsOn(database),
    reportLostConnection: Function.constVoid,
    definitionNames: sharingOneStream,
  });
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

function lockOf(name: string): string {
  return `hashtextextended('definition_names_1:${alpha}reasoning/${name}', 0)`;
}

async function untilOneWaitsOnALock(database: string): Promise<void> {
  const watching = await connected(database);
  await until(async () => {
    const { rows } = await watching.query(
      "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
    );
    return Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ waiting: Schema.Number })]))(rows)[0].waiting > 0;
  });
}

describe.skipIf(skipped)(`The names of definitions on PostgreSQL${notice}`, () => {
  it('locks every definition of an append and then every name it claims, each in their order, whatever the order of its facts', async () => {
    const database = await aDatabase();
    const store = await aStoreOn(database);
    const holding = await connected(database);
    await holding.query('BEGIN');
    await holding.query(`SELECT pg_advisory_xact_lock(${lockOf('y')})`);

    const appending = store
      .append('playbook/acme/alpha/definitions/reasoning', [claim('b', 'y'), claim('a', 'x')], at(0))
      .then(() => null);
    await untilOneWaitsOnALock(database);
    const probing = await connected(database);
    const { rows } = await probing.query(`SELECT pg_try_advisory_lock(${lockOf('x')}) AS free`);
    await holding.query('ROLLBACK');
    await appending;

    expect(rows).toEqual([{ free: false }]);
  });
});
