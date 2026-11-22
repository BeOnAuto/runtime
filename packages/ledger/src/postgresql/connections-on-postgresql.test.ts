import { Effect, Function, Layer, Logger } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { endingOf, sweepsWatched } from '../content/watched-sweeps.ts';
import { openChoresWith, openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlConnected, postgresqlDatabasesOn, postgresqlQueried } from '../testing/postgresql-databases.ts';
import { aStatementGate, type StatementGate } from '../testing/statement-gate.ts';
import { tally } from '../testing/tally.ts';
import { lostConnectionLogged, lostConnectionsLoggedWith } from './lost-connections.ts';
import { plainPoolsOn, postgresqlLedgerLayer, postgresqlLedgerOpened } from './postgresql-ledger.ts';
import { emmettsMigrationLock, longestMigrationLockWaitMs, type LockWaiting } from './postgresql-run-outcomes.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

const lostConnection = `"message":${JSON.stringify(lostConnectionLogged)},"level":"WARN"`;

function otherConnectionsTo(database: string): string {
  return `FROM pg_stat_activity WHERE datname = '${new URL(database).pathname.slice(1)}' AND pid <> pg_backend_pid()`;
}

function endingConnectionsTo(database: string): string {
  return `SELECT pg_terminate_backend(pid) AS ended ${otherConnectionsTo(database)}`;
}

const severalTriesOfTheLock = 3;

interface Tries {
  readonly waiting: LockWaiting;
  readonly tried: Promise<number>;
  readonly letGo: () => void;
}

function triesUntilLetGo(tries: number): Tries {
  const counted = { pauses: 0 };
  const tried = Promise.withResolvers<number>();
  const letGo = Promise.withResolvers<void>();
  return {
    waiting: {
      mostWaitMs: longestMigrationLockWaitMs,
      now: () => 0,
      pause: () => {
        counted.pauses += 1;
        if (counted.pauses < tries) {
          return Promise.resolve();
        }
        tried.resolve(counted.pauses);
        return letGo.promise;
      },
    },
    tried: tried.promise,
    letGo: letGo.resolve,
  };
}

function waitingFor(opened: Promise<unknown>): LockWaiting {
  return { mostWaitMs: longestMigrationLockWaitMs, now: () => 0, pause: () => opened };
}

function sweptOn(database: string, gate: StatementGate, held?: Promise<void>) {
  return sweepsWatched(
    () => postgresqlLedgerOpened({ pools: gate.pools(database), reportLostConnection: Function.constVoid }),
    held,
  );
}

describe.skipIf(skipped)(`A ledger on a PostgreSQL database of its own${notice}`, () => {
  it('builds on a database that another server is migrating at the same moment', async () => {
    const database = await aDatabase();
    const firstOpened = Promise.withResolvers<void>();
    const secondOpened = Promise.withResolvers<void>();

    const [first, second] = await Promise.all([
      openLedgerWith(
        postgresqlLedgerLayer({
          pools: plainPoolsOn(database),
          migrationLockWaiting: waitingFor(secondOpened.promise),
        }),
      ).finally(() => {
        firstOpened.resolve();
      }),
      openLedgerWith(
        postgresqlLedgerLayer({
          pools: plainPoolsOn(database),
          migrationLockWaiting: waitingFor(firstOpened.promise),
        }),
      ).finally(() => {
        secondOpened.resolve();
      }),
    ]);
    await Effect.runPromise(first.ledger.execute('org/acme/tallies', tally, [1]));
    const loaded = await Effect.runPromise(second.ledger.load('org/acme/tallies', tally));
    await Promise.all([first.dispose(), second.dispose()]);

    expect(loaded).toEqual({ state: 1, version: 1 });
  });

  it('holds one connection once its chore has swept, and closes every connection when the runtime is disposed', async () => {
    const gate = aStatementGate();
    const watched = sweptOn(await aDatabase(), gate);
    const { ledger, sweptAt, dispose } = await openChoresWith(watched.layer);
    await sweptAt(Date.now());
    await watched.finished;
    await Effect.runPromise(ledger.load('org/acme/tallies', tally));
    const whileOpen = gate.open();

    await dispose();
    await gate.allClosed();

    expect(whileOpen).toBe(1);
  });
});

describe.skipIf(skipped)(`A ledger on PostgreSQL whose runtime is disposed while it sweeps${notice}`, () => {
  it('finishes the sweep under way and then closes every connection', async () => {
    const gate = aStatementGate();
    const held = Promise.withResolvers<void>();
    const watched = sweptOn(await aDatabase(), gate, held.promise);
    const { sweptAt, dispose } = await openChoresWith(watched.layer);
    const sweeping = endingOf(sweptAt(Date.now()));
    await watched.started;

    const disposing = dispose();
    held.resolve();
    await disposing;

    await gate.allClosed();

    expect(await Promise.all([watched.finished, sweeping])).toEqual(['swept', 'ended']);
  });
});

describe.skipIf(skipped)(`A ledger whose PostgreSQL database another server is filling${notice}`, () => {
  it('tries the migration lock again and again while the fill holds it, and builds once the fill is done', async () => {
    const database = await aDatabase();
    const filling = await postgresqlConnected(database);
    await filling.query('SELECT pg_advisory_lock($1)', [emmettsMigrationLock]);
    const fill = { done: false };
    const tries = triesUntilLetGo(severalTriesOfTheLock);

    const opening = openLedgerWith(
      postgresqlLedgerLayer({ pools: plainPoolsOn(database), migrationLockWaiting: tries.waiting }),
    ).then((opened) => ({
      opened,
      afterTheFill: fill.done,
    }));
    await tries.tried;
    fill.done = true;
    await filling.query('SELECT pg_advisory_unlock($1)', [emmettsMigrationLock]);
    tries.letGo();
    const { opened, afterTheFill } = await opening;
    onTestFinished(opened.dispose);

    expect(afterTheFill).toBe(true);
    expect(await Effect.runPromise(opened.ledger.execute('org/acme/tallies', tally, [1]))).toEqual({
      state: 1,
      version: 1,
      decidedOn: 0,
    });
  });
});

async function aLedgerLogging(database: string) {
  const logged: string[] = [];
  const counts: { readonly count: number; readonly reached: () => void }[] = [];
  const logging = Logger.layer([
    Logger.map(Logger.formatJson, (line: string) => {
      logged.push(line);
      for (const { count, reached } of counts) {
        if (logged.length >= count) {
          reached();
        }
      }
    }),
  ]);
  const loggedAtLeast = (count: number): Promise<void> => {
    const reached = Promise.withResolvers<void>();
    counts.push({ count, reached: reached.resolve });
    if (logged.length >= count) {
      reached.resolve();
    }
    return reached.promise;
  };
  const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(logging)));
  const watched = sweepsWatched(() =>
    postgresqlLedgerOpened({ pools: plainPoolsOn(database), reportLostConnection: lostConnectionsLoggedWith(context) }),
  );
  const { ledger, sweptAt, dispose } = await openChoresWith(watched.layer.pipe(Layer.provide(logging)));
  onTestFinished(dispose);
  await sweptAt(Date.now());
  return { ledger, logged, loggedAtLeast, firstSweep: watched.finished };
}

describe.skipIf(skipped)(`A ledger whose PostgreSQL database ends its connections${notice}`, () => {
  it('reports each lost connection to the log, and goes on reading and appending on new ones', async () => {
    const database = await aDatabase();
    const { ledger, logged, loggedAtLeast, firstSweep } = await aLedgerLogging(database);
    expect(await firstSweep).toBe('swept');
    await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [1]));

    const ended = await postgresqlQueried(database, endingConnectionsTo(database));
    await loggedAtLeast(ended.length);

    expect(await Effect.runPromise(ledger.load('org/acme/tallies', tally))).toEqual({ state: 1, version: 1 });
    expect(await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [2]))).toEqual({
      state: 3,
      version: 2,
      decidedOn: 1,
    });

    expect(ended.length).toBeGreaterThan(0);
    expect(logged.filter((line) => !line.includes(lostConnection))).toEqual([]);
  });

  it("keeps each event's data as its JSON text and its context as plain jsonb in Emmett's messages table", async () => {
    const database = await aDatabase();
    const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [2]));
    await dispose();

    expect(
      await postgresqlQueried(
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
