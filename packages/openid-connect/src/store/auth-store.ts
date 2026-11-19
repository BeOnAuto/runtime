import type { ProviderRows } from '../authorization-server/provider-rows.ts';
import {
  signingKeyTable,
  signingKeyTables,
  storedSigningKeyRows,
  type SigningKeyRows,
} from '../authorization-server/signing-key-rows.ts';
import {
  providerModelsTable,
  providerModelTables,
  storedProviderRows,
} from '../authorization-server/stored-provider-rows.ts';
import type { PeopleRows } from '../people/people-rows.ts';
import { peopleTable, peopleTables, storedPeopleRows } from '../people/stored-people-rows.ts';
import { ambientTransactionSuppressed, type AuthDatabase } from './auth-database.ts';
import {
  authLayout,
  authLayoutKept,
  authLayoutSteps,
  sessionsOfAnEarlierLayout,
  type AuthLayoutCarrying,
} from './auth-layout.ts';

export interface AuthStore {
  readonly peopleRows: PeopleRows;
  readonly providerRows: ProviderRows;
  readonly signingKeyRows: SigningKeyRows;
}

const theStoreKept: AuthLayoutCarrying = {
  kept: authLayout,
  steps: authLayoutSteps,
  tables: [sessionsOfAnEarlierLayout, peopleTable, providerModelsTable, signingKeyTable],
};

export async function authStoreOpened(database: AuthDatabase): Promise<AuthStore> {
  const outsideAnyTransaction = ambientTransactionSuppressed(database);
  await authLayoutKept(outsideAnyTransaction, theStoreKept);
  await outsideAnyTransaction.migrated([...peopleTables, ...providerModelTables, ...signingKeyTables]);
  return {
    peopleRows: storedPeopleRows(outsideAnyTransaction),
    providerRows: storedProviderRows(outsideAnyTransaction),
    signingKeyRows: storedSigningKeyRows(outsideAnyTransaction),
  };
}
