import { nodeSqliteDumboDriver } from '@on.auto/node-sqlite';
import { describe, expect, it, onTestFinished } from 'vitest';

import { pooledOptionsOf } from '../sqlite-event-store.ts';
import { openConnectionWith } from '../testing/open-ledger.ts';
import { onEachSQLiteDriver, type OnASQLiteDriver } from '../testing/sqlite-drivers.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { statement } from './statement.ts';

function aDatabaseFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

async function heldForWriting({ optionsOf }: OnASQLiteDriver, fileName: string): Promise<() => Promise<void>> {
  const { pool } = pooledOptionsOf(() => optionsOf(fileName));
  const begun = Promise.withResolvers<void>();
  const letGo = Promise.withResolvers<void>();
  const held = pool.withTransaction(async () => {
    begun.resolve();
    await letGo.promise;
  });
  await begun.promise;
  return async () => {
    letGo.resolve();
    await held;
    await pool.close();
  };
}

function readsOf(sqlite: OnASQLiteDriver, fileName: string) {
  const reads = sqlite.sqliteLedgerReads({ fileName });
  onTestFinished(reads.close);
  return reads;
}

describe.each(onEachSQLiteDriver(() => nodeSqliteDumboDriver))(
  'the reads of the file of a ledger through $through',
  (sqlite) => {
    it('answer what the ledger keeps while another connection holds the file for writing, waiting for no lock', async () => {
      const fileName = aDatabaseFile();
      const { connection, dispose } = await openConnectionWith(sqlite.ledgerLayer({ fileName }));
      await connection.migrated([statement`CREATE TABLE IF NOT EXISTS probes (name TEXT NOT NULL)`]);
      await connection.write(statement`INSERT INTO probes (name) VALUES (${'kept'})`);
      await dispose();
      const released = await heldForWriting(sqlite, fileName);

      const rows = await readsOf(sqlite, fileName).read(statement`SELECT name FROM probes`);
      await released();

      expect(rows).toEqual([{ name: 'kept' }]);
    });

    it('migrate nothing, so a file that holds no ledger is left without a table', async () => {
      const rows = await readsOf(sqlite, aDatabaseFile()).read(statement`SELECT name FROM sqlite_master`);

      expect(rows).toEqual([]);
    });
  },
);
