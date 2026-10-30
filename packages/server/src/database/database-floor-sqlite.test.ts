import { structureOfTheSQLiteFile } from '@on.auto/ledger/database-structure';
import { ledgerLayoutFloor } from '@on.auto/ledger/testing';
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

describe('the SQLite database made at the floor', () => {
  it('is in the layout of the floor, made as database-floor-sqlite.json describes it, every table and index in the order the server made them, with the rows the stores keep of their own', () => {
    const ledger = aLedgerOfTheTest();

    aDatabaseFrom(theSQLiteFloor(), ledger.fileName);

    expect(theSQLiteFloor().layout).toBe(ledgerLayoutFloor);
    expect(databaseDumpOf(ledger.fileName)).toEqual(theSQLiteFloor());
  });
});
