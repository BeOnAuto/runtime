import { Effect, Function, Layer, Logger, Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { endingOf, sweepsWatched } from '../content/watched-sweeps.ts';
import { openChoresWith, openLedgerWith } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';
import { until } from '../testing/until.ts';
import { lostConnectionsLoggedWith } from './lost-connections.ts';
import { plainPoolsOn, postgresqlLedgerLayer, postgresqlLedgerOpened } from './postgresql-ledger.ts';
import { emmettsMigrationLock } from './postgresql-run-outcomes.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

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
  const name = `ledger_${crypto.randomUUID().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await queried(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

const lostConnection =
  '"message":"A connection to the PostgreSQL database of the ledger was lost; the ledger opens another when it needs one","level":"WARN"';

function otherConnectionsTo(database: string): string {
  return `FROM pg_stat_activity WHERE datname = '${new URL(database).pathname.slice(1)}' AND pid <> pg_backend_pid()`;
}

function lastLockTryOn(database: string): string {
  return `SELECT (extract(epoch FROM max(query_start)) * 1000)::float8 AS tried_at ${otherConnectionsTo(database)} AND query LIKE '%pg_try_advisory_xact_lock%'`;
}

function connectionsTo(database: string): string {
  return `SELECT count(*)::int AS open ${otherConnectionsTo(database)}`;
}

function endingConnectionsTo(database: string): string {
  return `SELECT pg_terminate_backend(pid) AS ended ${otherConnectionsTo(database)}`;
}

const migratorsOwnWaitMs = 10_000;

const decodeLastTry = Schema.decodeUnknownSync(
  Schema.Tuple([Schema.Struct({ tried_at: Schema.NullOr(Schema.Number) })]),
);

async function untilTriedAgainPast(database: string, pastMs: number): Promise<void> {
  const tries: number[] = [];
  await until(async () => {
    const [{ tried_at: triedAt }] = decodeLastTry(await queried(database, lastLockTryOn(database)));
    tries.push(...(triedAt === null ? [] : [triedAt]));
    expect(Math.max(...tries) - Math.min(...tries)).toBeGreaterThan(pastMs);
  });
}

async function untilNoneOpen(database: string): Promise<void> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await until(async () => {
      const { rows } = await client.query<Readonly<Record<string, unknown>>>(connectionsTo(database));
      expect({ afterDisposal: rows }).toEqual({ afterDisposal: [{ open: 0 }] });
    });
  } finally {
    await client.end();
  }
}

function sweptOn(database: string, held?: Promise<void>) {
  return sweepsWatched(
    () => postgresqlLedgerOpened({ pools: plainPoolsOn(database), reportLostConnection: Function.constVoid }),
    held,
  );
}

describe.skipIf(skipped)(`A ledger on a PostgreSQL database of its own${notice}`, () => {
  it('builds on a database that another server is migrating at the same moment', async () => {
    const database = await aDatabase();

    const [first, second] = await Promise.all([
      openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) })),
      openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) })),
    ]);
    await Effect.runPromise(first.ledger.execute('org/acme/tallies', tally, [1]));
    const loaded = await Effect.runPromise(second.ledger.load('org/acme/tallies', tally));
    await Promise.all([first.dispose(), second.dispose()]);

    expect(loaded).toEqual({ state: 1, version: 1 });
  });

  it('holds one connection once its chore has swept, and closes every connection when the runtime is disposed', async () => {
    const database = await aDatabase();
    const watched = sweptOn(database);
    const { ledger, sweptAt, dispose } = await openChoresWith(watched.layer);
    await sweptAt(Date.now());
    await watched.finished;
    await Effect.runPromise(ledger.load('org/acme/tallies', tally));
    const whileOpen = await queried(database, connectionsTo(database));

    await dispose();

    expect(whileOpen).toEqual([{ open: 1 }]);
    await untilNoneOpen(database);
  });
});

describe.skipIf(skipped)(`A ledger on PostgreSQL whose runtime is disposed while it sweeps${notice}`, () => {
  it('finishes the sweep under way and then closes every connection', async () => {
    const database = await aDatabase();
    const held = Promise.withResolvers<void>();
    const watched = sweptOn(database, held.promise);
    const { sweptAt, dispose } = await openChoresWith(watched.layer);
    const sweeping = endingOf(sweptAt(Date.now()));
    await watched.started;

    const disposing = dispose();
    held.resolve();
    await disposing;

    expect(await Promise.all([watched.finished, sweeping])).toEqual(['swept', 'ended']);
    await untilNoneOpen(database);
  });
});

describe.skipIf(skipped)(`A ledger whose PostgreSQL database another server is filling${notice}`, () => {
  it('waits past the 10 s the migrator itself waits for the migration lock, and builds once the fill is done', async () => {
    const database = await aDatabase();
    const filling = new Client({ connectionString: database });
    await filling.connect();
    onTestFinished(() => filling.end());
    await filling.query('SELECT pg_advisory_lock($1)', [emmettsMigrationLock]);
    const fill = { done: false };

    const opening = openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) })).then((opened) => ({
      opened,
      afterTheFill: fill.done,
    }));
    await untilTriedAgainPast(database, migratorsOwnWaitMs);
    fill.done = true;
    await filling.query('SELECT pg_advisory_unlock($1)', [emmettsMigrationLock]);
    const { opened, afterTheFill } = await opening;
    onTestFinished(opened.dispose);

    expect(afterTheFill).toBe(true);
    expect(await Effect.runPromise(opened.ledger.execute('org/acme/tallies', tally, [1]))).toEqual({
      state: 1,
      version: 1,
    });
  });
});

async function aLedgerLogging(database: string) {
  const logged: string[] = [];
  const logging = Logger.layer([
    Logger.map(Logger.formatJson, (line: string) => {
      logged.push(line);
    }),
  ]);
  const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(logging)));
  const watched = sweepsWatched(() =>
    postgresqlLedgerOpened({ pools: plainPoolsOn(database), reportLostConnection: lostConnectionsLoggedWith(context) }),
  );
  const { ledger, sweptAt, dispose } = await openChoresWith(watched.layer.pipe(Layer.provide(logging)));
  onTestFinished(dispose);
  await sweptAt(Date.now());
  return { ledger, logged, firstSweep: watched.finished };
}

describe.skipIf(skipped)(`A ledger whose PostgreSQL database ends its connections${notice}`, () => {
  it('reports each lost connection to the log, and goes on reading and appending on new ones', async () => {
    const database = await aDatabase();
    const { ledger, logged, firstSweep } = await aLedgerLogging(database);
    expect(await firstSweep).toBe('swept');
    await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [1]));

    const ended = await queried(database, endingConnectionsTo(database));
    await until(() => {
      expect(logged).toHaveLength(ended.length);
    });

    expect(await Effect.runPromise(ledger.load('org/acme/tallies', tally))).toEqual({ state: 1, version: 1 });
    expect(await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [2]))).toEqual({ state: 3, version: 2 });
    expect(ended.length).toBeGreaterThan(0);
    expect(logged.filter((line) => !line.includes(lostConnection))).toEqual([]);
  });

  it("keeps each event's data as its JSON text and its context as plain jsonb in Emmett's messages table", async () => {
    const database = await aDatabase();
    const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [2]));
    await dispose();

    expect(
      await queried(
        database,
        "SELECT stream_id, stream_position::int, message_type, message_data, message_metadata ->> 'by' AS by FROM emt_messages",
      ),
    ).toEqual([
      {
        stream_id: 'org/acme/tallies',
        stream_position: 1,
        message_type: 'counted',
        message_data: { json: '{"by":2}' },
        by: 'tester',
      },
    ]);
  });
});
