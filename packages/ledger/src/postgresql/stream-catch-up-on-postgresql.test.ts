import { randomUUID } from 'node:crypto';

import type { Ledger } from '@on.auto/operations';
import { labelFacts, labelReadModelOf, type LabelFact } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { openLedgerWith } from '../testing/open-ledger.ts';
import { until } from '../testing/until.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const alpha = { org: 'acme', playbook: 'alpha' };

const n1 = 'playbook/acme/alpha/notes/n1';

const everyRow = { where: [], orderBy: [], order: 'asc', limit: 1000 } as const;

const theCheckpointLock =
  "SELECT pg_advisory_xact_lock(hashtextextended('labelled_checkpoints_1:playbook/acme/alpha/notes/n1', 0))";

async function connected(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

async function queried(database: string, statement: string): Promise<readonly unknown[]> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    return (await client.query<Readonly<Record<string, unknown>>>(statement)).rows;
  } finally {
    await client.end();
  }
}

async function aDatabase(): Promise<string> {
  const name = `catch_up_${randomUUID().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await queried(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

async function aLedger(database: string, kept: boolean): Promise<Ledger['Service']> {
  const streamProjections = kept ? [labelReadModelOf()] : [];
  const { ledger, dispose } = await openLedgerWith(
    postgresqlLedgerLayer({ pools: plainPoolsOn(database), streamProjections, mostBytesFilledAtOnce: 1 }),
  );
  onTestFinished(dispose);
  return ledger;
}

function labelled(ledger: Ledger['Service'], ...facts: readonly LabelFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(n1, labelFacts, facts));
}

function set(...labels: readonly string[]): LabelFact {
  return { type: 'labels_set', data: { note: 'n1', labels } };
}

async function setsOf(ledger: Ledger['Service']): Promise<readonly string[]> {
  return (await Effect.runPromise(ledger.readProjectedRows('label_sets', alpha, everyRow))).map(({ key }) => key);
}

const checkpoint = 'SELECT CAST(folded_through AS INTEGER) AS folded_through FROM labelled_checkpoints_1';

async function untilAnAppendWaitsOnALock(database: string): Promise<void> {
  await until(async () => {
    expect(
      await queried(
        database,
        "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
      ),
    ).toEqual([{ waiting: 1 }]);
  });
}

describe.skipIf(skipped)(`An append that meets a catch-up of its stream on PostgreSQL${notice}`, () => {
  it('waits for the catch-up’s page to commit, then folds after the checkpoint it wrote', async () => {
    const database = await aDatabase();
    await labelled(await aLedger(database, false), set('a'));
    const ledger = await aLedger(database, true);
    const catchingUp = await connected(database);
    await catchingUp.query('BEGIN');
    await catchingUp.query(theCheckpointLock);

    const appending = labelled(ledger, set('b'));
    await untilAnAppendWaitsOnALock(database);
    await catchingUp.query(
      "INSERT INTO labelled_checkpoints_1 (playbook_key, stream, folded_through) VALUES ('playbook/acme/alpha/', 'notes/n1', 1)",
    );
    await catchingUp.query('COMMIT');
    await appending;

    expect([await queried(database, checkpoint), await setsOf(ledger)]).toEqual([[{ folded_through: 2 }], ['n1/2']]);
  });
});

describe.skipIf(skipped)(`An append that meets a catch-up leaving its checkpoint behind on PostgreSQL${notice}`, () => {
  it('folds nothing when the catch-up left its checkpoint behind, and the next read folds both facts', async () => {
    const database = await aDatabase();
    await labelled(await aLedger(database, false), set('a'));
    const ledger = await aLedger(database, true);
    const catchingUp = await connected(database);
    await catchingUp.query('BEGIN');
    await catchingUp.query(theCheckpointLock);

    const appending = labelled(ledger, set('b'));
    await untilAnAppendWaitsOnALock(database);
    await catchingUp.query('COMMIT');
    await appending;
    const left = await queried(database, checkpoint);

    expect([left, await setsOf(ledger), await queried(database, checkpoint)]).toEqual([
      [],
      ['n1/1', 'n1/2'],
      [{ folded_through: 2 }],
    ]);
  });
});

describe.skipIf(skipped)(`Appends beside the pages of a catch-up on PostgreSQL${notice}`, () => {
  it('leaves the rows of every fact once, whatever the order of the pages of a catch-up and the appends beside it', async () => {
    const database = await aDatabase();
    const before = await aLedger(database, false);
    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: 30 }, (_, at) => at),
        (at) => before.execute(n1, labelFacts, [set(`${at}`)]),
        { discard: true },
      ),
    );
    const ledger = await aLedger(database, true);

    const reading = setsOf(ledger);
    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: 10 }, (_, at) => at),
        (at) => ledger.execute(n1, labelFacts, [set(`late ${at}`)]),
        { discard: true },
      ),
    );
    await reading;

    expect([(await setsOf(ledger)).length, await queried(database, checkpoint)]).toEqual([
      40,
      [{ folded_through: 40 }],
    ]);
  });
});
