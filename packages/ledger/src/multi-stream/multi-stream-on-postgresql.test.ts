import { Conflict, type KeptProjection, type ProjectedMessage } from '@on.auto/operations';
import { noteHolders, runTallyRows } from '@on.auto/operations/testing';
import { Function, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { type DefinitionNames, type EncodedEvent, isVersionConflict, type LedgerStore } from '../index.ts';
import { plainPoolsOn, postgresqlEventStore, type PostgreSQLOptions } from '../postgresql/postgresql-ledger.ts';
import { postgresqlConnected, postgresqlDatabasesOn, postgresqlQueried } from '../testing/postgresql-databases.ts';
import { until } from '../testing/until.ts';
import { alpha, at, began, to } from './multi-stream-cases.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

interface Kept {
  readonly projections?: readonly KeptProjection[];
  readonly definitionNames?: DefinitionNames;
}

async function aStoreOn(database: string, kept: Kept = {}): Promise<LedgerStore> {
  const store = postgresqlEventStore({
    pools: plainPoolsOn(database),
    reportLostConnection: Function.constVoid,
    ...kept,
  });
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

function noted(by: string): EncodedEvent {
  return { type: 'noted', data: { by } };
}

const waitingOnALock =
  "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'";

async function untilOneWaitsOnALock(database: string): Promise<void> {
  await until(
    () => postgresqlQueried(database, waitingOnALock),
    (rows) => JSON.stringify(rows) === JSON.stringify([{ waiting: 1 }]),
  );
}

function settled(appended: Promise<void>): Promise<unknown> {
  return appended.then(
    () => 'kept',
    (error: unknown) => error,
  );
}

async function lockedNow(database: string, stream: string): Promise<string> {
  const client = await postgresqlConnected(database);
  await client.query('BEGIN');
  try {
    await client.query('SELECT 1 FROM emt_streams WHERE stream_id = $1 FOR UPDATE NOWAIT', [stream]);
    return 'free';
  } catch (error) {
    return String(error);
  } finally {
    await client.query('ROLLBACK');
  }
}

function lockedInTheOrderOfTheirNames(): void {
  it('takes the lock of each stream in the order of their names, whatever the order of its requests', async () => {
    const database = await aDatabase();
    const store = await aStoreOn(database);
    const [a, b] = [`${alpha}notes/a`, `${alpha}notes/b`] as const;
    await store.multiStreamAppend([to(a, 0, noted('first')), to(b, 0, noted('first'))]);
    const holding = await postgresqlConnected(database);
    await holding.query('BEGIN');
    await holding.query('SELECT 1 FROM emt_streams WHERE stream_id = $1 FOR UPDATE', [b]);

    const appending = settled(store.multiStreamAppend([to(b, 1, noted('second')), to(a, 1, noted('second'))]));
    await untilOneWaitsOnALock(database);
    const whileWaiting = await lockedNow(database, a);
    await holding.query('ROLLBACK');

    expect(whileWaiting).toContain('could not obtain lock on row in relation "emt_streams');
    expect(await appending).toBe('kept');
    expect([(await store.read(a)).version, (await store.read(b)).version]).toEqual([2, 2]);
  });
}

interface Round {
  readonly kept: number;
  readonly refused: number;
  readonly by: number;
  readonly facts: number;
}

async function raced(
  store: LedgerStore,
  xMultiStreamPostgresql: string,
  yMultiStreamPostgresql: string,
): Promise<Round> {
  const outcomes = await Promise.all([
    settled(
      store.multiStreamAppend([
        to(xMultiStreamPostgresql, 0, noted('one')),
        to(yMultiStreamPostgresql, 0, noted('one')),
      ]),
    ),
    settled(
      store.multiStreamAppend([
        to(yMultiStreamPostgresql, 0, noted('other')),
        to(xMultiStreamPostgresql, 0, noted('other')),
      ]),
    ),
  ]);
  const facts = (
    await Promise.all(
      [xMultiStreamPostgresql, yMultiStreamPostgresql].map(async (stream) => (await store.read(stream)).messages),
    )
  ).flat();
  return {
    kept: outcomes.filter((outcome) => outcome === 'kept').length,
    refused: outcomes.filter((outcome) => isVersionConflict(outcome)).length,
    by: new Set(facts.map(({ data }) => JSON.stringify(data))).size,
    facts: facts.length,
  };
}

function racedInOppositeOrders(): void {
  it('keeps one of two appends that share streams, given in opposite orders at once, whole, and refuses the other whole', async () => {
    const store = await aStoreOn(await aDatabase());
    const rounds = Array.from({ length: 20 }, (_, round) => round);

    const outcomes = await Promise.all(
      rounds.map((round) => raced(store, `${alpha}notes/x${round}`, `${alpha}notes/y${round}`)),
    );

    expect(outcomes).toEqual(rounds.map(() => ({ kept: 1, refused: 1, by: 1, facts: 2 })));
  });
}

const ofAlpha = { kind: 'playbook', playbookKey: alpha, definitionKeys: [] } as const;

const fromTheStart = { after: null, most: 10, dataOf: [] };

function heldBackUntilItCommits(): void {
  it("holds back every fact of the append from a reader, and from a read of the org's records, until it commits, and a fact committed meanwhile behind it", async () => {
    const database = await aDatabase();
    const store = await aStoreOn(database, { projections: [runTallyRows] });
    const holding = await postgresqlConnected(database);
    await holding.query('BEGIN');
    await holding.query(`SELECT pg_advisory_xact_lock(hashtextextended('run_tallies_2:${alpha}r1', 0))`);

    const appending = settled(
      store.multiStreamAppend([to(`${alpha}runs/r1`, 0, began), to(`${alpha}runs/r0`, 0, began)]),
    );
    await untilOneWaitsOnALock(database);
    await store.append(`${alpha}runs/r2`, [began], at(0));
    const whileOpen = await store.readAppendedFacts(ofAlpha, fromTheStart);
    const ofTheOrgWhileOpen = await store.readRecordedOfOrg('acme', { order: 'asc', limit: 10 });
    await holding.query('ROLLBACK');
    const kept = await appending;
    const ofTheOrg = await store.readRecordedOfOrg('acme', { order: 'asc', limit: 10 });

    expect(whileOpen).toMatchObject({ held: true, facts: [] });
    expect([ofTheOrgWhileOpen.records, ofTheOrg.records.length]).toEqual([[], 3]);
    expect(kept).toBe('kept');
    expect(await store.readAppendedFacts(ofAlpha, fromTheStart)).toMatchObject({
      held: true,
      facts: ['r0', 'r1', 'r2'].map((run) => ({ stream: `${alpha}runs/${run}`, version: 1 })),
    });
  });
}

const claimed = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String }));

function definitionKeyOfTheStream(stream: string): string | undefined {
  const segments = stream.split('/');
  return segments.length > 3 ? `${segments.slice(0, 3).join('/')}/` : undefined;
}

const names: DefinitionNames = {
  types: ['named'],
  holdsNames: () => true,
  definitionKeyOf: ({ stream }) => definitionKeyOfTheStream(stream),
  nameAfter: (_held, { data }: ProjectedMessage) => ({
    playbookKey: alpha,
    definitionType: 'reasoning',
    name: claimed(data).name,
    status: 'active',
    hasTriggers: false,
  }),
  takenBy: () => new Conflict({ detail: 'The name is taken', kind: 'taken' }),
};

const definition = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/';

function aDeadlockMetAsAConflict(): void {
  it('meets a deadlock PostgreSQL breaks inside its transaction as a version conflict, and keeps nothing', async () => {
    const database = await aDatabase();
    const store = await aStoreOn(database, { definitionNames: names });
    const holding = await postgresqlConnected(database);
    await holding.query("SET deadlock_timeout = '1min'");
    await holding.query('BEGIN');
    await holding.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('definition_names_1:${alpha}reasoning/triage', 0))`,
    );

    const appending = settled(
      store.multiStreamAppend([
        to(`${definition}definitions`, 0, { type: 'named', data: { name: 'triage' } }),
        to(`${alpha}notes/n1`, 0, noted('beside')),
      ]),
    );
    await untilOneWaitsOnALock(database);
    const crossing = holding.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('definition_names_1:${definition}', 0))`,
    );
    const refused = await appending;
    await crossing;
    await holding.query('ROLLBACK');

    expect(isVersionConflict(refused)).toBe(true);
    expect((await store.log.after(undefined, 10)).events).toEqual([]);
  });
}

function named(name: string): EncodedEvent {
  return { type: 'named', data: { name } };
}

async function metBehindAClaimOutsideTheKeeper(
  database: string,
  name: string,
  appended: () => Promise<void>,
): Promise<unknown> {
  const claiming = await postgresqlConnected(database);
  await claiming.query('BEGIN');
  await claiming.query(
    `INSERT INTO definition_names_1 (playbook_key, definition_type, name, definition_key, status, has_triggers)
      VALUES ($1, 'reasoning', $2, $3, 'active', FALSE)`,
    [alpha, name, `definition/acme/holding-${name}/`],
  );
  const appending = settled(appended());
  await untilOneWaitsOnALock(database);
  await claiming.query('COMMIT');
  return appending;
}

function aKeyBrokenMetAsAConflict(): void {
  it("meets a key of the names keeper's table broken by a claim it did not see as a version conflict, as an append to one stream does, and keeps nothing", async () => {
    const database = await aDatabase();
    const store = await aStoreOn(database, { definitionNames: names });

    const refused = [
      await metBehindAClaimOutsideTheKeeper(database, 'triage', () =>
        store.multiStreamAppend([
          to(`${definition}definitions`, 0, named('triage')),
          to(`${alpha}notes/n1`, 0, noted('beside')),
        ]),
      ),
      await metBehindAClaimOutsideTheKeeper(database, 'summary', () =>
        store.append(`${definition}definitions`, [named('summary')], at(0)),
      ),
    ];

    expect(refused.map((error) => isVersionConflict(error))).toEqual([true, true]);
    expect((await store.log.after(undefined, 10)).events).toEqual([]);
  });
}

type KeptLockOrderPostgresql = Pick<PostgreSQLOptions, 'holders'>;

async function aStoreOnLockOrderPostgresql(database: string, kept: KeptLockOrderPostgresql): Promise<LedgerStore> {
  const store = postgresqlEventStore({
    pools: plainPoolsOn(database),
    reportLostConnection: Function.constVoid,
    ...kept,
  });
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

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
  await until(
    () => postgresqlQueried(database, waitingOnALock),
    (rows) => JSON.stringify(rows) === JSON.stringify([{ waiting }]),
  );
}

async function untilKeptOrWaitingOnALock(database: string, appending: Settling, waiting: number): Promise<void> {
  await until(
    () => postgresqlQueried(database, waitingOnALock),
    (rows) => appending.settled() || JSON.stringify(rows) === JSON.stringify([{ waiting }]),
  );
}

const [d1, d2] = ['1'.repeat(64), '2'.repeat(64)] as const;

function noteKept(sha256: string): EncodedEvent {
  return { type: 'note_kept', data: { sha256 } };
}

const [x, y, z] = [`${alpha}notes/x`, `${alpha}notes/y`, `${alpha}notes/z`] as const;

function holdsInOneOrder(): void {
  it('locks the holds on content of all its streams in one order, so it meets an append to another stream of the playbook that changes the same holds without a deadlock', async () => {
    const database = await aDatabase();
    const store = await aStoreOnLockOrderPostgresql(database, { holders: noteHolders });
    await store.append(x, [noteKept(d2)], at(0));
    const holding = await postgresqlConnected(database);
    await holding.query('BEGIN');
    await holding.query(
      "SELECT 1 FROM content_references_2 WHERE playbook_key = $1 AND stream = 'notes/x' AND sha256 = $2 FOR UPDATE",
      [alpha, d2],
    );

    const several = settling(store.multiStreamAppend([to(y, 0, noteKept(d1)), to(x, 1, noteKept(d2))]));
    await untilWaitingOnALock(database, 1);
    const one = settling(store.append(z, [noteKept(d1), noteKept(d2)], at(0)));
    await untilKeptOrWaitingOnALock(database, one, 2);
    await holding.query('ROLLBACK');

    expect([await several.outcome, await one.outcome]).toEqual(['kept', 'kept']);
    expect(
      await postgresqlQueried(
        database,
        'SELECT stream, sha256, held::int AS held FROM content_references_2 ORDER BY stream, sha256',
      ),
    ).toEqual([
      { stream: 'notes/x', sha256: d2, held: 2 },
      { stream: 'notes/y', sha256: d1, held: 1 },
      { stream: 'notes/z', sha256: d1, held: 1 },
      { stream: 'notes/z', sha256: d2, held: 1 },
    ]);
  });
}

describe.skipIf(skipped)(`An append to several streams on PostgreSQL${notice}`, () => {
  lockedInTheOrderOfTheirNames();
  racedInOppositeOrders();
  heldBackUntilItCommits();
  aDeadlockMetAsAConflict();
  aKeyBrokenMetAsAConflict();
});

describe.skipIf(skipped)(`The locks of an append to several streams on PostgreSQL, in one order${notice}`, () => {
  holdsInOneOrder();
});
