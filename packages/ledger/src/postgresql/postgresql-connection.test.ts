import { describe, expect, it } from 'vitest';

import type { ConnectionPorts } from '../connection/ledger-connection.ts';
import type { StatementAnswer } from '../connection/statement-answers.ts';
import { statement, textOnPostgreSQL, type StatementValue } from '../connection/statement.ts';
import type { LedgerStreams, StoredRecord } from '../event-store.ts';
import { postgresqlConnectionOn, type Connection } from './postgresql-connection.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly StatementValue[];
}

interface Telling {
  readonly connection: ConnectionPorts;
  readonly asked: () => readonly Asked[];
  readonly said: () => readonly string[];
}

const streams: LedgerStreams = {
  mostEventsInOneAppend: 64,
  pointLength: 2,
  read: () => Promise.resolve({ version: 0, messages: [] }),
  append: () => Promise.resolve(),
  readRecorded: () => Promise.resolve({ records: [] }),
  readRecordedEvent: (_, id) => Promise.resolve(new Map<string, StoredRecord>().get(id)),
  readAppended: () => Promise.resolve({ streams: [], through: ['0', '0'], more: false }),
  definitionStreams: () => Promise.resolve([]),
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

const snapshotBegun = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';

const firstRead = statement`SELECT checkpoint FROM folder_rows WHERE playbook_key = ${'a'}`;

const secondRead = statement`SELECT COUNT(*) AS rows FROM folder_rows`;

function bothRead({ connection }: Telling) {
  return connection.readConsistently((read) => Promise.all([read(firstRead), read(secondRead)]));
}

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
