import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';

import { sqliteFileLedgerOn } from './connection/sqlite-file-ledger.ts';

export { aSQLiteFileInLayout } from './layout/sqlite-file-in-layout.ts';
export { modestConnections, type LedgerOptions } from './connection/sqlite-file-ledger.ts';

export const { ledgerLayer, sqliteLedgerFile, sqliteLedgerReads } = sqliteFileLedgerOn(() => sqlite3EventStoreDriver);
