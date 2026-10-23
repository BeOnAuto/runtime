import type { AppendObserver } from '@on.auto/ledger';
import { ledgerLayer, sqliteSecretRows } from '@on.auto/ledger/sqlite3';

import type { LedgerDatabase } from './ledger-database.ts';

export function sqliteLedgerDatabase(file: string, observer?: AppendObserver): LedgerDatabase {
  return {
    ledgerLayer: (kept) => ledgerLayer({ ...kept, fileName: file, observer }),
    secretRows: sqliteSecretRows({ fileName: file }),
  };
}
