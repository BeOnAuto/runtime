import type { Custodians } from '../custodians/custodian.ts';
import { sealedKeeper } from '../keepers/sealed-keeper.ts';
import type { SecretRows } from '../rows/secret-rows.ts';
import { secretStoreOn, type SecretStore } from './secret-store.ts';

export function sealedSecretStoreOn(rows: SecretRows, custodians: Custodians): SecretStore {
  return secretStoreOn(rows, { current: sealedKeeper(custodians) }, custodians);
}
