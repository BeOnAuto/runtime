import { setTimeout } from 'node:timers/promises';

import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayer } from '../sqlite3.ts';
import { stamped } from '../testing/happenings.ts';
import { openConnectionWith, type OpenConnection } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import type { ReadRows } from './ledger-connection.ts';
import { statement } from './statement.ts';

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
