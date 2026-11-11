import { DatabaseSync } from 'node:sqlite';

import { structureOfTheSQLiteFile } from '@on.auto/ledger/database-structure';
import { ledgerLayoutFloor } from '@on.auto/ledger/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { aDatabaseFrom, databaseDumpOf, theSQLiteFloor } from '../testing/records/database-floor.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { loopbackSettingsOver } from '../testing/servers/reasoning-server.ts';

function aLedgerOfTheTest(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

async function openedOn(ledger: TemporaryLedger): Promise<string> {
  const server = await startServer(loopbackSettingsOver(ledger), compositionRoot);
  await server.stop();
  return ledger.fileName;
}

describe('the layout of the database the server opens in SQLite', () => {
  it('is, in the columns, types, nullability, defaults, primary keys and indexes of every table, the layout a database made at the floor, database-floor-sqlite.json, is carried forward to by every step', async () => {
    const carried = aLedgerOfTheTest();
    aDatabaseFrom(theSQLiteFloor(), carried.fileName);

    const [made, carriedForward] = [
      await structureOfTheSQLiteFile(await openedOn(aLedgerOfTheTest())),
      await structureOfTheSQLiteFile(await openedOn(carried)),
    ];

    expect(
      carriedForward,
      'A SQLite database made at the floor and carried forward by every step differs from a new one: a step leaves the database as a new database of its layout would be',
    ).toEqual(made);
  });
});

const place = {
  playbook_key: 'playbook/acme/sales/',
  cursor: 'cursor-of-the-place',
  delivered: '["trigger_starts","close"]',
  attempts: 3,
  waiting: 0,
  checked: 7,
};

function placesIn(file: string): readonly unknown[] {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    return database.prepare('SELECT * FROM workflow_followed_playbooks').all();
  } finally {
    database.close();
  }
}

function placeKeptIn(file: string): void {
  const database = new DatabaseSync(file);
  try {
    database
      .prepare(
        'INSERT INTO workflow_followed_playbooks (playbook_key, cursor, delivered, attempts, waiting, checked) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(...Object.values(place));
  } finally {
    database.close();
  }
}

describe('the place a follower kept in a playbook, in a SQLite database made at the floor', () => {
  it('reads as it did once every step carried the database forward, with no hold of the follower', async () => {
    const ledger = aLedgerOfTheTest();
    aDatabaseFrom(theSQLiteFloor(), ledger.fileName);
    placeKeptIn(ledger.fileName);

    const before = placesIn(ledger.fileName);
    const after = placesIn(await openedOn(ledger));

    expect([before, after]).toEqual([
      [place],
      [{ ...place, held_since: null, held_until: null, holds: 0, held_for: null }],
    ]);
  });
});

function hostTablesDroppedIn(file: string): void {
  const database = new DatabaseSync(file);
  try {
    const [{ tables }] = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ tables: Schema.String })]))(
      database
        .prepare(
          "SELECT group_concat(name, ', ') AS tables FROM sqlite_master WHERE type = 'table' AND name LIKE 'workflow\\_%' ESCAPE '\\'",
        )
        .all(),
    );
    for (const table of tables.split(', ')) {
      database.exec(`DROP TABLE ${table}`);
    }
  } finally {
    database.close();
  }
}

describe('a SQLite database made at the floor whose first opening ended before the workflow host made its tables', () => {
  it('is carried forward by every step all the same, each step making the table it changes, and opens as a new one', async () => {
    const carried = aLedgerOfTheTest();
    aDatabaseFrom(theSQLiteFloor(), carried.fileName);
    hostTablesDroppedIn(carried.fileName);

    const [made, carriedForward] = [
      await structureOfTheSQLiteFile(await openedOn(aLedgerOfTheTest())),
      await structureOfTheSQLiteFile(await openedOn(carried)),
    ];

    expect(carriedForward).toEqual(made);
  });
});

describe('the SQLite database made at the floor', () => {
  it('is in the layout of the floor, made as database-floor-sqlite.json describes it, every table and index in the order the server made them, with the rows the stores keep of their own', () => {
    const ledger = aLedgerOfTheTest();

    aDatabaseFrom(theSQLiteFloor(), ledger.fileName);

    expect(theSQLiteFloor().layout).toBe(ledgerLayoutFloor);
    expect(databaseDumpOf(ledger.fileName)).toEqual(theSQLiteFloor());
  });
});
