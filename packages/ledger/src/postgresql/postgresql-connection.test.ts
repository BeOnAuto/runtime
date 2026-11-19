import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import type { HeldName } from '@on.auto/operations/definition-names';
import { Effect, Function, Logger, Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { StreamsCarrying } from '../connection/appends-with.ts';
import type { OpenedConnection } from '../connection/ledger-connection.ts';
import { nodeSqliteEventStoreDriver } from '../connection/node-sqlite-event-store-driver.ts';
import type { StatementAnswer } from '../connection/statement-answers.ts';
import { statement, type StatementValue, textOnPostgreSQL } from '../connection/statement.ts';
import { emmettEventStore, type EmmettStore } from '../emmett/emmett-event-store.ts';
import type { RecordedMessage, StoredRecord } from '../event-store.ts';
import { eventAppenderOf, VersionConflict } from '../index.ts';
import { stamped } from '../testing/happenings.ts';
import { outcomeOf } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';
import { until } from '../testing/until.ts';
import { dataAsJsonText } from './json-text.ts';
import { lostConnectionLogged, lostConnectionsLoggedWith } from './lost-connections.ts';
import { type Connection, postgresqlConnectionOn } from './postgresql-connection.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly StatementValue[];
}

interface Telling {
  readonly connection: OpenedConnection;
  readonly asked: () => readonly Asked[];
  readonly said: () => readonly string[];
}

const streams: StreamsCarrying = {
  mostEventsInOneAppend: 64,
  pointLength: 2,
  read: () => Promise.resolve({ version: 0, messages: [] }),
  readPage: () => Promise.resolve({ messages: [], through: 0, more: false }),
  messageAt: (stream) => Promise.resolve(new Map<string, RecordedMessage>().get(stream)),
  lastMessageOf: (stream) => Promise.resolve(new Map<string, RecordedMessage>().get(stream)),
  versionOf: () => Promise.resolve(0),
  append: () => Promise.resolve(),
  appendWithin: () => Promise.resolve(),
  readRecorded: () => Promise.resolve({ records: [] }),
  readRecordedOfKeys: () => Promise.resolve({ records: [] }),
  readRecordedOfOrg: () => Promise.resolve({ records: [] }),
  readRecordedEvent: (_, id) => Promise.resolve(new Map<string, StoredRecord>().get(id)),
  readRecordedEventOfKeys: (_, id) => Promise.resolve(new Map<string, StoredRecord>().get(id)),
  readAppended: () => Promise.resolve({ streams: [], through: ['0', '0'], more: false }),
  readAppendedFacts: () => Promise.resolve({ held: false }),
  waitForAppend: () => Promise.resolve('ended'),
  endWaits: Function.constVoid,
  definitionStreams: () => Promise.resolve([]),
  orgStreams: () => Promise.resolve([]),
  holderOfName: ({ name }) => Promise.resolve(new Map<string, HeldName>().get(name)),
  nameHeldBy: (definitionKey) => Promise.resolve(new Map<string, HeldName>().get(definitionKey)),
  namesHeldIn: () => Promise.resolve([]),
  holdersOfName: () => Promise.resolve([]),
  definitionsIn: () => Promise.resolve([]),
  holderOfStream: ({ stream }) => Promise.resolve(new Map<string, string>().get(stream)),
  holderOfRunId: ({ runId }) => Promise.resolve(new Map<string, string>().get(runId)),
  ageOfLastAppend: () => Promise.resolve(Number.POSITIVE_INFINITY),
};

function telling(failingOn = '', rowsOf = (text: string): readonly unknown[] => [{ answered: text }]): Telling {
  const asked: Asked[] = [];
  const said: string[] = [];
  const answerOf = (text: string): StatementAnswer => {
    const rows = rowsOf(text);
    return { rows, rowCount: rows.length };
  };
  const connection: Connection = {
    query: (text, values = []) => {
      asked.push({ text, values });
      return text === failingOn ? Promise.reject(new Error(`${text} failed`)) : Promise.resolve(answerOf(text));
    },
    release: () => {
      said.push('connection released');
    },
  };
  return {
    connection: postgresqlConnectionOn(
      {
        query: (text, values) => {
          asked.push({ text, values });
          return Promise.resolve(answerOf(text));
        },
        connect: () => Promise.resolve(connection),
      },
      streams,
    ),
    asked: () => asked,
    said: () => said,
  };
}

const tableOfAFolder = statement`CREATE TABLE IF NOT EXISTS folder_rows (playbook_key TEXT NOT NULL PRIMARY KEY)`;

const indexOfAFolder = statement`CREATE INDEX IF NOT EXISTS folder_rows_by_key ON folder_rows (playbook_key)`;

const runsMoved = statement`UPDATE workflow_runs SET status = ${'ended'} WHERE run_key = ${'a'}`;

const checkpointMoved = statement`UPDATE folder_rows SET checkpoint = ${'2'} WHERE playbook_key = ${'a'} AND checkpoint = ${'1'}
  RETURNING playbook_key`;

const transactionAsked: readonly Asked[] = [
  { text: 'BEGIN', values: [] },
  { text: textOnPostgreSQL(runsMoved), values: ['ended', 'a'] },
  { text: textOnPostgreSQL(checkpointMoved), values: ['2', 'a', '1'] },
];

function answeringNothingTo(text: string): (asked: string) => readonly unknown[] {
  return (asked) => (asked === text ? [] : [{ answered: asked }]);
}

const snapshotBegun = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';

const firstRead = statement`SELECT checkpoint FROM folder_rows WHERE playbook_key = ${'a'}`;

const secondRead = statement`SELECT COUNT(*) AS rows FROM folder_rows`;

function bothRead({ connection }: Telling) {
  return connection.readConsistently((read) => Promise.all([read(firstRead), read(secondRead)]));
}

function anEmmettStore(): EmmettStore {
  const store = getSQLiteEventStore({
    driver: nodeSqliteEventStoreDriver,
    fileName: ':memory:',
    schema: { autoMigration: 'None' },
  });
  onTestFinished(() => store.close());
  return store;
}

const run = 'run/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const awkward = { zeta: 'a NUL \u0000 inside', a: { y: 'half a pair \uD800 alone', x: [1, null] } };

const lostConnectionWarning = `{"message":${JSON.stringify(lostConnectionLogged)},"level":"WARN"`;

describe('the connection of the ledger on PostgreSQL, making the tables beside the ledger', () => {
  it('makes them in one transaction under a lock of its own, and keeps them', async () => {
    const { connection, asked, said } = telling();

    await connection.migrated([tableOfAFolder, indexOfAFolder]);

    expect(asked()).toEqual([
      { text: 'BEGIN', values: [] },
      { text: 'SELECT pg_advisory_xact_lock($1)', values: [7_461_239_041] },
      { text: textOnPostgreSQL(tableOfAFolder), values: [] },
      { text: textOnPostgreSQL(indexOfAFolder), values: [] },
      { text: 'COMMIT', values: [] },
    ]);
    expect(said()).toEqual(['connection released']);
  });

  it('rolls them back, and gives its connection back, when a table cannot be made', async () => {
    const { connection, asked, said } = telling(textOnPostgreSQL(indexOfAFolder));

    await expect(connection.migrated([tableOfAFolder, indexOfAFolder])).rejects.toThrow(
      `${textOnPostgreSQL(indexOfAFolder)} failed`,
    );
    expect(asked().slice(-2)).toEqual([
      { text: textOnPostgreSQL(indexOfAFolder), values: [] },
      { text: 'ROLLBACK', values: [] },
    ]);
    expect(said()).toEqual(['connection released']);
  });
});

describe('the connection of the ledger on PostgreSQL, open', () => {
  it('reads and writes with its values numbered, and names its dialect and the streams of the ledger', async () => {
    const { connection, asked } = telling();

    const read = await connection.read(statement`SELECT ${1} AS one`);
    const written = await connection.write(statement`DELETE FROM workflow_due WHERE run_key = ${'a'}`);

    expect(asked()).toEqual([
      { text: 'SELECT $1 AS one', values: [1] },
      { text: 'DELETE FROM workflow_due WHERE run_key = $1', values: ['a'] },
    ]);
    expect([read, written]).toEqual([
      [{ answered: 'SELECT $1 AS one' }],
      [{ answered: 'DELETE FROM workflow_due WHERE run_key = $1' }],
    ]);
    expect([connection.dialect, connection.streams]).toEqual(['postgresql', streams]);
  });
});

describe('the connection of the ledger on PostgreSQL, writing in one transaction', () => {
  it('runs the statements in order on one connection and keeps them, answering what the last answers, when the last writes a row', async () => {
    const { connection, asked, said } = telling();

    const written = await connection.transaction([runsMoved, checkpointMoved]);

    expect(asked()).toEqual([...transactionAsked, { text: 'COMMIT', values: [] }]);
    expect([written, said().at(-1)]).toEqual([
      [{ answered: textOnPostgreSQL(checkpointMoved) }],
      'connection released',
    ]);
  });

  it('keeps none of them when the last writes no row, as when another wrote the row first', async () => {
    const { connection, asked } = telling('', answeringNothingTo(textOnPostgreSQL(checkpointMoved)));

    const written = await connection.transaction([runsMoved, checkpointMoved]);

    expect(asked()).toEqual([...transactionAsked, { text: 'ROLLBACK', values: [] }]);
    expect(written).toEqual([]);
  });

  it('keeps none of them, and fails with the error of the driver, when one fails midway', async () => {
    const { connection, asked, said } = telling(textOnPostgreSQL(checkpointMoved));

    await expect(connection.transaction([runsMoved, checkpointMoved])).rejects.toThrow(
      `${textOnPostgreSQL(checkpointMoved)} failed`,
    );
    expect(asked()).toEqual([...transactionAsked, { text: 'ROLLBACK', values: [] }]);
    expect(said().at(-1)).toBe('connection released');
  });
});

describe('the connection of the ledger on PostgreSQL, telling the time', () => {
  it('reads the clock of the database, which every server on it shares, in milliseconds', async () => {
    const { connection, asked } = telling('', () => [{ now: '1790845200000' }]);

    const now = await connection.sharedClock?.();

    expect(now).toBe(1_790_845_200_000);
    expect(asked()).toEqual([{ text: 'SELECT (EXTRACT(EPOCH FROM now()) * 1000)::bigint AS now', values: [] }]);
  });
});

describe('the connection of the ledger on PostgreSQL, reading in one snapshot', () => {
  it('reads on one connection in a transaction that only reads and sees one snapshot, and ends it keeping nothing', async () => {
    const told = telling();

    const read = await bothRead(told);

    expect(told.asked()).toEqual([
      { text: snapshotBegun, values: [] },
      { text: textOnPostgreSQL(firstRead), values: ['a'] },
      { text: textOnPostgreSQL(secondRead), values: [] },
      { text: 'ROLLBACK', values: [] },
    ]);
    expect([read, told.said().at(-1)]).toEqual([
      [[{ answered: textOnPostgreSQL(firstRead) }], [{ answered: textOnPostgreSQL(secondRead) }]],
      'connection released',
    ]);
  });

  it('fails with the error of the driver when a read fails, and still ends the snapshot', async () => {
    const told = telling(textOnPostgreSQL(secondRead));

    await expect(bothRead(told)).rejects.toThrow(`${textOnPostgreSQL(secondRead)} failed`);
    expect([told.asked().at(-1), told.said().at(-1)]).toEqual([
      { text: 'ROLLBACK', values: [] },
      'connection released',
    ]);
  });

  it.each([
    ['cannot begin', snapshotBegun],
    ['cannot be ended', 'ROLLBACK'],
  ])('fails, and gives its connection back, when its snapshot %s', async (_when, failingOn) => {
    const told = telling(failingOn);

    await expect(bothRead(told)).rejects.toThrow(`${failingOn} failed`);
    expect(told.said().at(-1)).toBe('connection released');
  });
});

describe('the data of an event kept as its JSON text', () => {
  it('is stored under json, and comes back exactly, keys in order', async () => {
    const emmett = anEmmettStore();
    const store = emmettEventStore(emmett, { data: dataAsJsonText, mostEventsInOneAppend: 64 });
    await store.migrate();

    await store.append(run, [{ type: 'noted', data: awkward }], { expectedVersion: 0, context: stamped });
    const read = await store.read(run);
    const stored = await emmett.readStream(run);

    expect(read).toMatchObject({ version: 1, messages: [{ data: awkward }] });
    expect(JSON.stringify(read.messages.map(({ data }) => data))).toBe(JSON.stringify([awkward]));
    expect(
      stored.events.map(({ type, data }: { readonly type: string; readonly data: unknown }) => ({ type, data })),
    ).toEqual([{ type: 'noted', data: { json: JSON.stringify(awkward) } }]);
  });

  it('is appended only at the version expected, and a wrong version meets a version conflict', async () => {
    const store = emmettEventStore(anEmmettStore(), { data: dataAsJsonText, mostEventsInOneAppend: 64 });
    await store.migrate();
    await store.append(run, [{ type: 'noted', data: awkward }], { expectedVersion: 0, context: stamped });

    expect(
      await outcomeOf(
        eventAppenderOf(store, tally.eventSchema)(run, [{ type: 'counted', data: { by: 1 } }], {
          expectedVersion: 0,
          context: stamped,
        }),
      ),
    ).toEqual(Result.fail(new VersionConflict()));
    expect(await store.read(run)).toMatchObject({ version: 1, messages: [{ data: awkward }] });
  });
});

describe('a connection to the PostgreSQL database that the database ends', () => {
  it('is logged as a warning with the message of the database, through the loggers of the runtime', async () => {
    const logged: string[] = [];
    const capture = Logger.map(Logger.formatJson, (line: string) => {
      logged.push(line);
    });
    const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(Logger.layer([capture]))));

    lostConnectionsLoggedWith(context)(new Error('terminating connection due to administrator command'));

    await until(
      () => logged.length,
      (count) => count > 0,
    );
    expect(logged).toEqual([expect.stringContaining(lostConnectionWarning)]);
    expect(logged[0]).toContain('"annotations":{"error":"terminating connection due to administrator command"}');
  });
});
