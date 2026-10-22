import { DatabaseSync } from 'node:sqlite';

import { ledgerLayout } from '@on.auto/ledger/testing';

export const anotherLayout = ledgerLayout + 1;

export function aLedgerOfAnotherVersionAt(file: string): void {
  const database = new DatabaseSync(file);
  database.exec(`PRAGMA user_version = ${anotherLayout}`);
  database.close();
}
