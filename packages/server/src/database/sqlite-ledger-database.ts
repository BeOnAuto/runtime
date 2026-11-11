import type { AppendObserver } from '@on.auto/ledger';
import { sqliteLedgerFile } from '@on.auto/ledger/sqlite3';

import type { LedgerDatabase } from './ledger-database.ts';

export function sqliteLedgerDatabase(file: string, observer?: AppendObserver): LedgerDatabase {
  const ledgerFile = sqliteLedgerFile(file);
  return {
    ledgerLayer: (kept) => ledgerFile.ledgerLayer({ ...kept, observer }),
    secretRows: ledgerFile.secretRows,
  };
}
