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
import type { InvitationAddresses } from '../people/invitation-addresses.ts';
import type { PeopleRows } from '../people/people-rows.ts';
import {
  invitationAddressesTable,
  invitationAddressesTables,
  storedInvitationAddresses,
} from '../people/stored-invitation-addresses.ts';
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
  readonly invitationAddresses: InvitationAddresses;
  readonly providerRows: ProviderRows;
  readonly signingKeyRows: SigningKeyRows;
}

const theStoreKept: AuthLayoutCarrying = {
  kept: authLayout,
  steps: authLayoutSteps,
  tables: [sessionsOfAnEarlierLayout, peopleTable, providerModelsTable, signingKeyTable, invitationAddressesTable],
};

export async function authStoreOpened(database: AuthDatabase): Promise<AuthStore> {
  const outsideAnyTransaction = ambientTransactionSuppressed(database);
  await authLayoutKept(outsideAnyTransaction, theStoreKept);
  await outsideAnyTransaction.migrated([
    ...peopleTables,
    ...providerModelTables,
    ...signingKeyTables,
    ...invitationAddressesTables,
  ]);
  return {
    peopleRows: storedPeopleRows(outsideAnyTransaction),
    invitationAddresses: storedInvitationAddresses(outsideAnyTransaction),
    providerRows: storedProviderRows(outsideAnyTransaction),
    signingKeyRows: storedSigningKeyRows(outsideAnyTransaction),
  };
}
