import { DatabaseSync } from 'node:sqlite';

const secretsOfAnOlderShape =
  'CREATE TABLE kept_secrets (id TEXT PRIMARY KEY, version INTEGER NOT NULL, kept_at TEXT NOT NULL, kept_by TEXT NOT NULL, held TEXT NOT NULL)';

export function aLedgerOfAnotherVersionAt(file: string): void {
  const database = new DatabaseSync(file);
  database.exec(secretsOfAnOlderShape);
  database.close();
}
