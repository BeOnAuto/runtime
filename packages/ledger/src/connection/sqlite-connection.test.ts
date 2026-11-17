import { DatabaseSync } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';

import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayer, sqliteLedgerReads } from '../sqlite.ts';
import { stamped } from '../testing/happenings.ts';
import { type OpenConnection, openConnectionWith } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import type { ReadRows } from './ledger-connection.ts';
import { statement, statementOf, textOnPostgreSQL } from './statement.ts';

function aDatabaseFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

async function connectedTo(fileName: string): Promise<OpenConnection> {
  const opened = await openConnectionWith(ledgerLayer({ fileName }));
  onTestFinished(opened.dispose);
  return opened;
}

const besideTable = statement`CREATE TABLE IF NOT EXISTS beside (name TEXT NOT NULL PRIMARY KEY, amount BIGINT NOT NULL)`;

const namesRead = statement`SELECT name FROM beside ORDER BY name`;

function added(name: string, amount = 1) {
  return statement`INSERT INTO beside (name, amount) VALUES (${name}, ${amount})`;
}

const figuresRead = statement`SELECT amount, (SELECT COUNT(*) FROM beside) AS counted FROM beside WHERE name = ${'north'}`;

const raised = statement`UPDATE beside SET amount = ${2} WHERE name = ${'north'}`;

async function withOneRow(fileName: string): Promise<OpenConnection> {
  const opened = await connectedTo(fileName);
  await opened.connection.migrated([besideTable, added('north')]);
  return opened;
}

function heldForWriting(fileName: string): () => void {
  const database = new DatabaseSync(fileName);
  database.exec('BEGIN IMMEDIATE');
  return () => {
    database.exec('ROLLBACK');
    database.close();
  };
}

function readsOf(fileName: string) {
  const reads = sqliteLedgerReads({ fileName });
  onTestFinished(reads.close);
  return reads;
}

const runKey = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

describe('the connection of the ledger on SQLite', () => {
  it('runs its statements in the database of the ledger, beside its tables, and appends its streams there', async () => {
    const fileName = aDatabaseFile();
    const first = await withOneRow(fileName);
    await first.connection.streams.append('org/acme/tallies', [{ type: 'counted', data: { by: 2 } }], {
      expectedVersion: 0,
      context: stamped,
    });
    const second = await connectedTo(fileName);

    expect(await second.connection.read(namesRead)).toEqual([{ name: 'north' }]);
    expect(await second.connection.read(statement`SELECT COUNT(*) AS streams FROM emt_streams`)).toEqual([
      { streams: 1 },
    ]);
    expect(await Effect.runPromise(second.ledger.load('org/acme/tallies', tally))).toEqual({ state: 2, version: 1 });
    expect([first.connection.dialect, first.connection.sharedClock]).toEqual(['sqlite', null]);
  });

  it('writes in one transaction, keeping it only when its last statement writes a row, and nothing of one that fails', async () => {
    const { connection } = await withOneRow(aDatabaseFile());

    const kept = await connection.transaction([
      added('east'),
      statement`UPDATE beside SET amount = ${3} WHERE name = ${'east'} RETURNING name`,
    ]);
    const unkept = await connection.transaction([
      added('south'),
      statement`UPDATE beside SET amount = ${3} WHERE name = ${'nobody'}`,
    ]);
    const failing = connection.transaction([added('west'), statement`INSERT INTO nowhere VALUES (${1})`]);

    await expect(failing).rejects.toThrow('no such table: nowhere');
    expect([kept, unkept, await connection.read(namesRead)]).toEqual([
      [{ name: 'east' }],
      [],
      [{ name: 'east' }, { name: 'north' }],
    ]);
  });
});

describe('the reads of the connection of the ledger in one snapshot, on SQLite', () => {
  it('read what was committed when their first read began, and none of what is written while they read', async () => {
    const { connection } = await withOneRow(aDatabaseFile());

    const read = await connection.readConsistently(async (reading) => {
      const before = await reading(figuresRead);
      await connection.write(raised);
      await connection.write(added('south', 5));
      return [...before, ...(await reading(figuresRead))];
    });

    expect([...read, ...(await connection.read(figuresRead))]).toEqual([
      { amount: 1, counted: 1 },
      { amount: 1, counted: 1 },
      { amount: 2, counted: 2 },
    ]);
  });

  it('fail as their reads fail', async () => {
    const { connection } = await withOneRow(aDatabaseFile());

    await expect(
      connection.readConsistently((reading) => reading(statement`SELECT amount FROM nowhere`)),
    ).rejects.toThrow('no such table: nowhere');
  });

  it('hold the one connection of a private database in memory, so a write asked meanwhile lands once they end', async () => {
    const { connection } = await withOneRow(':memory:');
    const firstRead = Promise.withResolvers<void>();
    const readTwice = async (reading: ReadRows) => {
      const before = await reading(figuresRead);
      firstRead.resolve();
      await setTimeout(50);
      return [...before, ...(await reading(figuresRead))];
    };

    const reading = connection.readConsistently(readTwice);
    await firstRead.promise;
    const writing = connection.write(raised);
    const read = await reading;
    await writing;

    expect([...read, ...(await connection.read(figuresRead))]).toEqual([
      { amount: 1, counted: 1 },
      { amount: 1, counted: 1 },
      { amount: 2, counted: 1 },
    ]);
  });
});

describe('the reads of the file of a ledger', () => {
  it('answer what the ledger keeps while another connection holds the file for writing, waiting for no lock', async () => {
    const fileName = aDatabaseFile();
    const { connection, dispose } = await openConnectionWith(ledgerLayer({ fileName }));
    await connection.migrated([statement`CREATE TABLE IF NOT EXISTS probes (name TEXT NOT NULL)`]);
    await connection.write(statement`INSERT INTO probes (name) VALUES (${'kept'})`);
    await dispose();
    const released = heldForWriting(fileName);

    const rows = await readsOf(fileName).read(statement`SELECT name FROM probes`);
    released();

    expect(rows).toEqual([{ name: 'kept' }]);
  });

  it('migrate nothing, so a file that holds no ledger is left without a table', async () => {
    const rows = await readsOf(aDatabaseFile()).read(statement`SELECT name FROM sqlite_master`);

    expect(rows).toEqual([]);
  });
});

describe('a statement beside the ledger', () => {
  it('numbers its values on PostgreSQL, in the order they appear', () => {
    const due = statement`UPDATE workflow_timers SET due_at = ${2000} WHERE run_key = ${runKey} AND timer_id = ${'1'}`;

    expect([textOnPostgreSQL(due), due.values]).toEqual([
      'UPDATE workflow_timers SET due_at = $1 WHERE run_key = $2 AND timer_id = $3',
      [2000, runKey, '1'],
    ]);
  });

  it('binds the same values on SQLite', async () => {
    const { connection, dispose } = await openConnectionWith(ledgerLayer({ fileName: ':memory:' }));
    onTestFinished(dispose);

    const rows = await connection.read(statement`SELECT ${7} AS seven, ${null} AS empty`);

    expect(rows).toEqual([{ seven: 7, empty: null }]);
  });
});

describe('a statement made of the texts between its values', () => {
  it('is the statement the tag makes of the same texts, its values bound in their order', () => {
    const table = 'workflow_timers';
    const made = statementOf([`UPDATE ${table} SET due_at = `, ' WHERE run_key = ', ''], [2000, runKey]);
    const tagged = statement`UPDATE workflow_timers SET due_at = ${2000} WHERE run_key = ${runKey}`;

    expect([textOnPostgreSQL(made), made.values, [...made.strings.raw]]).toEqual([
      textOnPostgreSQL(tagged),
      tagged.values,
      [...tagged.strings.raw],
    ]);
  });
});
