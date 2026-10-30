import type { AppendObserver } from '@on.auto/ledger';
import { postgresqlLedgerLayer, postgresqlSecretRows, type PostgreSQLPools } from '@on.auto/ledger/postgresql';
import type { ProxySettings } from '@on.auto/outbound';

import type { PostgreSQLLedgerSettings } from '../settings/ledger-settings.ts';
import { databasePoolsOf } from './database-pools.ts';
import type { LedgerDatabase } from './ledger-database.ts';

export function postgresqlLedgerDatabase(pools: PostgreSQLPools, observer?: AppendObserver): LedgerDatabase {
  return {
    ledgerLayer: (kept) => postgresqlLedgerLayer({ ...kept, pools, observer }),
    secretRows: postgresqlSecretRows({ pools }),
  };
}

export function postgresqlLedgerDatabaseOf(
  ledger: PostgreSQLLedgerSettings,
  proxy: ProxySettings,
  observer?: AppendObserver,
): LedgerDatabase {
  return postgresqlLedgerDatabase(databasePoolsOf(ledger, proxy), observer);
}
