import sqlite3 from 'sqlite3';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqliteLedgerReads } from '../sqlite3.ts';
import { openConnection } from '../testing/open-ledger.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { statement } from './statement.ts';

function aDatabaseFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

function settled(resolve: () => void, reject: (reason: unknown) => void) {
  return (error: Readonly<Error> | null): void => {
    if (error === null) {
      resolve();
    } else {
      reject(error);
    }
  };
}

async function heldForWriting(fileName: string): Promise<() => Promise<void>> {
  const database = new sqlite3.Database(fileName);
  const ran = (sql: string) =>
    new Promise<void>((resolve, reject) => {
      database.run(sql, settled(resolve, reject));
    });
  await ran('BEGIN IMMEDIATE');
  return async () => {
    await ran('ROLLBACK');
    await new Promise<void>((resolve, reject) => {
      database.close(settled(resolve, reject));
    });
  };
}

function readsOf(fileName: string) {
  const reads = sqliteLedgerReads({ fileName });
  onTestFinished(reads.close);
  return reads;
}

describe('the reads of the file of a ledger', () => {
  it('answer what the ledger keeps while another connection holds the file for writing, waiting for no lock', async () => {
    const fileName = aDatabaseFile();
    const { connection, dispose } = await openConnection(fileName);
    await connection.migrated([statement`CREATE TABLE IF NOT EXISTS probes (name TEXT NOT NULL)`]);
    await connection.write(statement`INSERT INTO probes (name) VALUES (${'kept'})`);
    await dispose();
    const released = await heldForWriting(fileName);

    const rows = await readsOf(fileName).read(statement`SELECT name FROM probes`);
    await released();

    expect(rows).toEqual([{ name: 'kept' }]);
  });

  it('migrate nothing, so a file that holds no ledger is left without a table', async () => {
    const rows = await readsOf(aDatabaseFile()).read(statement`SELECT name FROM sqlite_master`);

    expect(rows).toEqual([]);
  });
});
