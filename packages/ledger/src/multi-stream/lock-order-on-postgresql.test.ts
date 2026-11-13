import { randomUUID } from 'node:crypto';

import type { StreamProjection } from '@on.auto/operations';
import { labelReadModelOf, noteHolders } from '@on.auto/operations/testing';
import { Function } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { EncodedEvent, LedgerStore } from '../index.ts';
import { plainPoolsOn, postgresqlEventStore, type PostgreSQLOptions } from '../postgresql/postgresql-ledger.ts';
import { until } from '../testing/until.ts';
import { alpha, at, to } from './multi-stream-cases.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

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
    const { rows } = await client.query<Readonly<Record<string, unknown>>>(statement);
    return rows;
  } finally {
    await client.end();
  }
}

async function aDatabase(): Promise<string> {
  const name = `lock_order_${randomUUID().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await queried(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

type Kept = Pick<PostgreSQLOptions, 'holders' | 'streamProjections'>;

async function aStoreOn(database: string, kept: Kept): Promise<LedgerStore> {
  const store = postgresqlEventStore({
    pools: plainPoolsOn(database),
    reportLostConnection: Function.constVoid,
    ...kept,
  });
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

const waitingOnALock =
  "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'";

interface Settling {
  readonly outcome: Promise<unknown>;
  readonly settled: () => boolean;
}

function settling(appended: Promise<void>): Settling {
  const state = { settled: false };
  const outcome = appended.then(
    () => 'kept',
    (error: unknown) => error,
  );
  void outcome.finally(() => {
    state.settled = true;
  });
  return { outcome, settled: () => state.settled };
}

async function untilWaitingOnALock(database: string, waiting: number): Promise<void> {
  await until(async () => {
    expect(await queried(database, waitingOnALock)).toEqual([{ waiting }]);
  });
}

async function untilKeptOrWaitingOnALock(database: string, appending: Settling, waiting: number): Promise<void> {
  await until(async () => {
    const [counted] = await queried(database, waitingOnALock);
    expect(appending.settled() ? { waiting } : counted).toEqual({ waiting });
  });
}

const [d1, d2] = ['1'.repeat(64), '2'.repeat(64)] as const;

function noteKept(sha256: string): EncodedEvent {
  return { type: 'note_kept', data: { sha256 } };
}

const [x, y, z] = [`${alpha}notes/x`, `${alpha}notes/y`, `${alpha}notes/z`] as const;

function holdsInOneOrder(): void {
  it('locks the holds on content of all its streams in one order, so it meets an append to another stream of the playbook that changes the same holds without a deadlock', async () => {
    const database = await aDatabase();
    const store = await aStoreOn(database, { holders: noteHolders });
    await store.append(x, [noteKept(d2)], at(0));
    const holding = await connected(database);
    await holding.query('BEGIN');
    await holding.query(
      "SELECT 1 FROM content_references_1 WHERE playbook_key = $1 AND stream = 'notes/x' AND sha256 = $2 FOR UPDATE",
      [alpha, d2],
    );

    const several = settling(store.multiStreamAppend([to(y, 0, noteKept(d1)), to(x, 1, noteKept(d2))]));
    await untilWaitingOnALock(database, 1);
    const one = settling(store.append(z, [noteKept(d1), noteKept(d2)], at(0)));
    await untilKeptOrWaitingOnALock(database, one, 2);
    await holding.query('ROLLBACK');

    expect([await several.outcome, await one.outcome]).toEqual(['kept', 'kept']);
    expect(
      await queried(
        database,
        'SELECT stream, sha256, held::int AS held FROM content_references_1 ORDER BY stream, sha256',
      ),
    ).toEqual([
      { stream: 'notes/x', sha256: d2, held: 2 },
      { stream: 'notes/y', sha256: d1, held: 1 },
      { stream: 'notes/z', sha256: d1, held: 1 },
      { stream: 'notes/z', sha256: d2, held: 1 },
    ]);
  });
}

const ofThreeStreams: StreamProjection = { ...labelReadModelOf(), streams: ['n1', 'n2', 'n3'] };

function labelsSet(note: string): EncodedEvent {
  return { type: 'labels_set', data: { note, labels: ['urgent'] } };
}

const [n1, n2, n3] = [`${alpha}notes/n1`, `${alpha}notes/n2`, `${alpha}notes/n3`] as const;

function checkpointsBeforeRows(): void {
  it("locks the checkpoints of a stream projection for all its streams before any row the projection's tables fold, so it meets an append to another of the projection's streams that folds into the same rows without a deadlock", async () => {
    const database = await aDatabase();
    const store = await aStoreOn(database, { streamProjections: [ofThreeStreams] });
    const holding = await connected(database);
    await holding.query('BEGIN');
    await holding.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `labelled_checkpoints_1:${alpha}notes/n2`,
    ]);

    const several = settling(store.multiStreamAppend([to(n1, 0, labelsSet('b')), to(n2, 0, labelsSet('a'))]));
    await untilWaitingOnALock(database, 1);
    const one = settling(store.append(n3, [labelsSet('a'), labelsSet('b')], at(0)));
    await untilKeptOrWaitingOnALock(database, one, 2);
    await holding.query('ROLLBACK');

    expect([await several.outcome, await one.outcome]).toEqual(['kept', 'kept']);
    expect(
      await queried(
        database,
        'SELECT stream, folded_through::int AS folded FROM labelled_checkpoints_1 ORDER BY stream',
      ),
    ).toEqual([
      { stream: 'notes/n1', folded: 1 },
      { stream: 'notes/n2', folded: 1 },
      { stream: 'notes/n3', folded: 2 },
    ]);
    expect(await queried(database, 'SELECT row_key FROM label_notes_1 ORDER BY row_key')).toEqual([
      { row_key: 'a' },
      { row_key: 'b' },
    ]);
  });
}

describe.skipIf(skipped)(`The locks of an append to several streams on PostgreSQL, in one order${notice}`, () => {
  holdsInOneOrder();
  checkpointsBeforeRows();
});
