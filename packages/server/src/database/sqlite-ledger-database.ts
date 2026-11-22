import type { AppendObserver } from '@on.auto/ledger';
import { sqliteLedgerFile } from '@on.auto/ledger/sqlite';

import type { LedgerDatabase } from './ledger-database.ts';

export function sqliteLedgerDatabase(
  file: string,
  observer?: AppendObserver,
  image?: Readonly<Uint8Array>,
): LedgerDatabase {
  const ledgerFile = sqliteLedgerFile(file, image);
  return {
    ledgerLayer: (kept) => ledgerFile.ledgerLayer({ ...kept, observer }),
    secretRows: ledgerFile.secretRows,
    receivedWebhooks: ledgerFile.receivedWebhooks,
  };
}
