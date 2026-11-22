import { randomUUID } from 'node:crypto';

import { runIdsOfTheTests } from '@on.auto/operations/testing';
import { Function, Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { at, began } from '../multi-stream/multi-stream-cases.ts';
import { plainPoolsOn, postgresqlEventStore } from '../postgresql/postgresql-ledger.ts';
import { conflictOfARefusal } from '../refusals/append-refused.ts';
import { aStatementGate, type StatementGate } from '../testing/statement-gate.ts';
import { runIdsOnStoresBehaviour } from './run-ids-on-stores-behaviour.ts';

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
  const name = `run_ids_${randomUUID().replaceAll('-', '')}`;
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

async function aStoreOn(database: string, gate: StatementGate): Promise<ReturnType<typeof postgresqlEventStore>> {
  const store = postgresqlEventStore({
    pools: gate.pools(database),
    reportLostConnection: Function.constVoid,
    runIds: runIdsOfTheTests,
  });
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

const decodeHolders = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ definition_key: Schema.String })));

async function racedWith(ending: 'COMMIT' | 'ROLLBACK') {
  const database = await aDatabase();
  const gate = aStatementGate();
  const store = await aStoreOn(database, gate);
  const claiming = gate.stopBefore('INSERT INTO run_ids_1');
  const claimAsked = gate.sent('INSERT INTO run_ids_1');

  const appending = store.append('definition/acme/d2/runs/r1', [began], at(0)).then(
    () => 'kept',
    (error: unknown) => conflictOfARefusal(error),
  );
  await claiming.reached;
  const holding = await connected(database);
  await holding.query('BEGIN');
  await holding.query(
    "INSERT INTO run_ids_1 (org_key, run_id, definition_key) VALUES ('org/acme/', 'r1', 'definition/acme/d1/')",
  );
  claiming.go();
  await claimAsked;
  await holding.query(ending);
  const answer = await appending;
  const { rows } = await holding.query('SELECT definition_key FROM run_ids_1');
  return { answer, holders: decodeHolders(rows).map(({ definition_key: key }) => key) };
}

describe.skipIf(skipped)(`The ids of runs on PostgreSQL${notice}`, () => {
  runIdsOnStoresBehaviour({
    aDatabase,
    storeOn: (database, runIds) =>
      postgresqlEventStore({ pools: plainPoolsOn(database), reportLostConnection: Function.constVoid, runIds }),
  });

  it('make the first fact of a run wait while another definition claims its id, then refuse it once that claim is committed', async () => {
    expect(await racedWith('COMMIT')).toEqual({
      answer: runIdsOfTheTests.heldElsewhere(),
      holders: ['definition/acme/d1/'],
    });
  });

  it('let it land once that claim is rolled back', async () => {
    expect(await racedWith('ROLLBACK')).toEqual({ answer: 'kept', holders: ['definition/acme/d2/'] });
  });
});
