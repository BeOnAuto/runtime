import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayer, sqliteLedgerReads } from '../sqlite3.ts';
import { openConnectionWith } from '../testing/open-ledger.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { statement } from './statement.ts';

function aDatabaseFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
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
