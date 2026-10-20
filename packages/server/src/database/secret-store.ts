import { postgresqlSecretRows } from '@on.auto/ledger/postgresql';
import { sqliteSecretRows } from '@on.auto/ledger/sqlite3';
import {
  localCustodian,
  sealedKeeper,
  secretStoreOn,
  type Custodians,
  type SecretRows,
  type SecretStore,
} from '@on.auto/secrets';
import type { DatabaseSettings } from '@on.auto/workflow-host';
import type { Effect } from 'effect';

import type { SecretKeys } from '../settings/secrets-settings.ts';

export function custodiansOf({ current, previous }: SecretKeys): Custodians {
  return {
    current: localCustodian(current),
    previous: previous === undefined ? undefined : localCustodian(previous),
  };
}

export function secretRowsOn(database: DatabaseSettings): Effect.Effect<SecretRows> {
  return database.store === 'postgresql'
    ? postgresqlSecretRows({ pools: database.pools })
    : sqliteSecretRows({ fileName: database.file });
}

export function secretStoreOver(rows: SecretRows, custodians: Custodians): SecretStore {
  return secretStoreOn(rows, sealedKeeper(custodians), custodians);
}
