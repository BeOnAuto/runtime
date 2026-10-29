import { randomUUID } from 'node:crypto';

import { Clock, Effect } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { postgresqlRecordedStore, type Query } from '../postgresql-reads/postgresql-recorded.ts';
import { details, happenings } from '../testing/happenings.ts';
import { openLedgerWith, type OpenLedger } from '../testing/open-ledger.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

async function queried(database: string, statement: string): Promise<readonly unknown[]> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    const { rows } = await client.query<Readonly<Record<string, unknown>>>(statement);
    return rows;
  } finally {
    await client.end();
  }
}

async function aDatabase(): Promise<string> {
  const name = `ledger_${randomUUID().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await queried(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

type RecordedSelection = Parameters<OpenLedger['ledger']['readRecorded']>[1];

const alpha = { org: 'acme', playbook: 'alpha' };

const noMetadata: Readonly<Record<string, string>> = {};

const stampedAsStored = { at: '2026-10-05T09:00:00.000Z', by: 'tester' };

async function anAppendLeftOpen(database: string, stream: string, type: string, meta = noMetadata): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  await client.query(
    `SELECT success FROM emt_append_to_stream(
      ARRAY['late-1'], ARRAY[$1::jsonb], ARRAY[$4::jsonb], ARRAY['1'], ARRAY[$2], ARRAY['E'], $3, 'playbook', 0, 'emt:default')`,
    [{ json: JSON.stringify({ detail: 'late' }) }, type, stream, { ...stampedAsStored, ...meta }],
  );
  return client;
}

type OpenWrite = { readonly client: Client; readonly id: string };

async function aWriteLeftOpenElsewhere(): Promise<OpenWrite> {
  const client = new Client({ connectionString: server });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  const { rows } = await client.query<{ readonly id: string }>('SELECT pg_current_xact_id()::text AS id');
  return { client, id: rows[0]?.id ?? '' };
}

async function aReaderEndingTheWriteMidway(database: string, endTheWrite: () => Promise<unknown>): Promise<Query> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  const answered = async (text: string, values: readonly unknown[]) =>
    (await client.query<Readonly<Record<string, unknown>>>(text, [...values])).rows;
  const write = { open: true };
  return async (text, values) => {
    if (!write.open || !text.includes('FROM emt_messages')) {
      return answered(text, values);
    }
    write.open = false;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query('SELECT 1');
    await endTheWrite();
    const rows = await answered(text, values);
    await client.query('COMMIT');
    return rows;
  };
}

function reading(ledger: OpenLedger['ledger'], selection: RecordedSelection, order: 'asc' | 'desc', cursor?: string) {
  return Effect.runPromise(
    ledger.readRecorded(alpha, selection, { order, limit: 10, ...(cursor === undefined ? {} : { cursor }) }),
  );
}

function noting(ledger: OpenLedger['ledger'], stream: string, type: string, detail: string): Promise<unknown> {
  return Effect.runPromise(ledger.execute(`playbook/acme/alpha/${stream}`, happenings, [{ type, data: { detail } }]));
}

const root = 'playbook/acme/alpha/runs/root';
const ofTheRoot = { causationId: null, correlationId: 'root' };

function notingOfRoot(ledger: OpenLedger['ledger'], type: string, detail: string): Promise<unknown> {
  return Effect.runPromise(ledger.execute(root, happenings, [{ type, data: { detail } }], ofTheRoot));
}

type OwnLedger = { readonly database: string; readonly ledger: OpenLedger['ledger'] };

async function aLedgerOnItsOwnDatabase(): Promise<OwnLedger> {
  const database = await aDatabase();
  const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
  onTestFinished(dispose);
  return { database, ledger };
}

const everything: RecordedSelection = { kind: 'everything' };

const runs: RecordedSelection = { kind: 'runs' };

describe.skipIf(skipped)(`A read on PostgreSQL while an append is still open${notice}`, () => {
  it('oldest first, stays behind it, and delivers every message once after it commits', async () => {
    const { database, ledger } = await aLedgerOnItsOwnDatabase();
    await noting(ledger, 'notes', 'noted', 'before');
    const open = await anAppendLeftOpen(database, 'playbook/acme/alpha/late', 'noted');
    await noting(ledger, 'notes', 'noted', 'after');

    const whileOpen = await reading(ledger, everything, 'asc');
    await open.query('COMMIT');
    const rest = await reading(ledger, everything, 'asc', String(whileOpen.records.at(-1)?.cursor));

    expect([details(whileOpen), details(rest)]).toEqual([['before'], ['late', 'after']]);
  });

  it('newest first, reads every message committed, the one committed after it included', async () => {
    const { database, ledger } = await aLedgerOnItsOwnDatabase();
    await noting(ledger, 'notes', 'noted', 'before');
    const open = await anAppendLeftOpen(database, 'playbook/acme/alpha/late', 'noted');
    await noting(ledger, 'notes', 'noted', 'after');

    const whileOpen = await reading(ledger, everything, 'desc');
    await open.query('COMMIT');
    const afterCommit = await reading(ledger, everything, 'desc');

    expect([details(whileOpen), details(afterCommit)]).toEqual([
      ['after', 'before'],
      ['after', 'late', 'before'],
    ]);
  });

  it('by correlation, stays behind it oldest first, and delivers the message committed late once after', async () => {
    const { database, ledger } = await aLedgerOnItsOwnDatabase();
    const correlated: RecordedSelection = { kind: 'correlated', correlation: 'root' };
    await notingOfRoot(ledger, 'run_started', 'before');
    const child = 'playbook/acme/alpha/runs/child';
    const open = await anAppendLeftOpen(database, child, 'run_started', { correlationId: 'root' });
    await notingOfRoot(ledger, 'run_succeeded', 'after');

    const whileOpen = await reading(ledger, correlated, 'asc');
    await open.query('COMMIT');
    const rest = await reading(ledger, correlated, 'asc', String(whileOpen.records.at(-1)?.cursor));

    expect([details(whileOpen), details(rest)]).toEqual([['before'], ['late', 'after']]);
  });
});

function appendedTo(ledger: OpenLedger['ledger'], after?: string) {
  const asked = { most: 10, dataOf: [], ...(after === undefined ? {} : { after }) };
  return Effect.runPromise(ledger.readAppendedFacts({ kind: 'playbook', playbook: alpha }, asked));
}

async function waitedFor(ledger: OpenLedger['ledger'], through: string): Promise<void> {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + 20_000;
  await Effect.runPromise(ledger.waitForAppend({ kind: 'playbook', playbook: alpha }, through, deadline));
}

describe.skipIf(skipped)(
  `The facts appended to a playbook on PostgreSQL while an append is still open${notice}`,
  () => {
    it('stay behind it, so a cursor of now leaves the message committed late to be read, and a wait ends once it commits', async () => {
      const { database, ledger } = await aLedgerOnItsOwnDatabase();
      await noting(ledger, 'notes', 'noted', 'before');
      const open = await anAppendLeftOpen(database, 'playbook/acme/alpha/late', 'noted');
      await noting(ledger, 'notes', 'noted', 'after');

      const now = await appendedTo(ledger);
      const whileOpen = await appendedTo(ledger, now.cursor);
      const woken = waitedFor(ledger, whileOpen.through);
      await open.query('COMMIT');
      await woken;
      const rest = await appendedTo(ledger, whileOpen.cursor);

      expect(whileOpen.facts).toEqual([]);
      expect(rest.facts.map(({ stream }) => stream)).toEqual(['playbook/acme/alpha/late', 'playbook/acme/alpha/notes']);
    });
  },
);

describe.skipIf(skipped)(`A list of runs on PostgreSQL while an append is still open${notice}`, () => {
  it('lists runs oldest first behind it, and every run once after it commits', async () => {
    const { database, ledger } = await aLedgerOnItsOwnDatabase();
    await noting(ledger, 'runs/r-before', 'run_started', 'before');
    const open = await anAppendLeftOpen(database, 'playbook/acme/alpha/runs/r-late', 'run_started');
    await noting(ledger, 'runs/r-after', 'run_started', 'after');

    const whileOpen = await reading(ledger, runs, 'asc');
    await open.query('COMMIT');
    const rest = await reading(ledger, runs, 'asc', String(whileOpen.records.at(-1)?.cursor));

    expect([details(whileOpen), details(rest)]).toEqual([['before'], ['late', 'after']]);
  });
});

const readsOldestFirst: readonly (readonly [string, RecordedSelection])[] = [
  ['a page of the playbook', everything],
  ['a list of runs', runs],
];

describe.skipIf(skipped)(
  `A read on PostgreSQL oldest first while a write of another database of the server is open${notice}`,
  () => {
    it('lets that write hide nothing while it stays open', async () => {
      const { ledger } = await aLedgerOnItsOwnDatabase();
      await noting(ledger, 'notes', 'noted', 'before');
      const elsewhere = await aWriteLeftOpenElsewhere();
      await noting(ledger, 'notes', 'noted', 'after');

      const whileOpen = await reading(ledger, everything, 'asc');
      await elsewhere.client.query('COMMIT');

      expect(details(whileOpen)).toEqual(['before', 'after']);
    });

    it.each(readsOldestFirst)(
      'lets that write hide nothing of %s when it ends after the read took its snapshot',
      async (_read, selection) => {
        const { database, ledger } = await aLedgerOnItsOwnDatabase();
        await noting(ledger, 'runs/r-before', 'run_started', 'before');
        const elsewhere = await aWriteLeftOpenElsewhere();
        await noting(ledger, 'runs/r-after', 'run_started', 'after');
        const reader = await aReaderEndingTheWriteMidway(database, () => elsewhere.client.query('COMMIT'));
        const store = postgresqlRecordedStore(reader);

        const page = await store.readRecorded('playbook/acme/alpha/', selection, { order: 'asc', limit: 10 });

        expect(page.records.map(({ data }) => data)).toEqual([{ detail: 'before' }, { detail: 'after' }]);
      },
    );
  },
);
