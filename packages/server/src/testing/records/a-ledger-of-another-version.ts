import { aSQLiteFileInLayout } from '@on.auto/ledger/sqlite3';
import { ledgerLayout } from '@on.auto/ledger/testing';

export const anotherLayout = ledgerLayout + 1;

export function aLedgerOfAnotherVersionAt(file: string): Promise<void> {
  return aSQLiteFileInLayout(file, anotherLayout);
}
