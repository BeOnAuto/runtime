import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface TemporaryDatabase {
  readonly fileName: string;
  readonly remove: () => void;
}

export function temporaryDatabase(): TemporaryDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-ledger-'));
  return {
    fileName: join(directory, 'ledger.db'),
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** The bytes of a database file, as an image a database in memory opens from: its journal kept beside it no more. */
export function imageOfTheDatabaseIn(fileName: string): Uint8Array {
  const database = new DatabaseSync(fileName);
  try {
    database.exec('PRAGMA journal_mode = DELETE');
    return database.serialize();
  } finally {
    database.close();
  }
}
