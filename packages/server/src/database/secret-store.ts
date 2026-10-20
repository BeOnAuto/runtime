import { postgresqlSecretRows } from '@on.auto/ledger/postgresql';
import { sqliteSecretRows } from '@on.auto/ledger/sqlite3';
import {
  localCustodian,
  sealedKeeper,
  secretStoreOn,
  type Custodian,
  type Custodians,
  type SecretRows,
  type SecretStore,
} from '@on.auto/secrets';
import type { DatabaseSettings } from '@on.auto/workflow-host';
import type { Effect } from 'effect';

import type { SecretsKeySource, SecretsSettings } from '../settings/secrets-settings.ts';
import { kmsCustodianOf, type CustodiansMaking } from './kms-custodians.ts';
import { keyInHandOf } from './secrets-keys.ts';

function custodianOf(source: SecretsKeySource, making: CustodiansMaking): Custodian | Promise<Custodian> {
  return source.from === 'kms' ? kmsCustodianOf(source, making) : localCustodian(keyInHandOf(source));
}

export async function custodiansOf(
  { current, previous }: SecretsSettings,
  making: CustodiansMaking,
): Promise<Custodians> {
  return {
    current: await custodianOf(current, making),
    previous: previous === undefined ? undefined : await custodianOf(previous, making),
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
