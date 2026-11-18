import type { PeopleRows } from '../people/people-rows.ts';
import { peopleTable, peopleTables, storedPeopleRows } from '../people/stored-people-rows.ts';
import type { SessionRows } from '../sessions/session-rows.ts';
import { sessionsTable, sessionTables, storedSessionRows } from '../sessions/stored-session-rows.ts';
import { ambientTransactionSuppressed, type AuthDatabase } from './auth-database.ts';
import { authLayout, authLayoutKept, authLayoutSteps, type AuthLayoutCarrying } from './auth-layout.ts';

export interface AuthStore {
  readonly sessionRows: SessionRows;
  readonly peopleRows: PeopleRows;
}

const theStoreKept: AuthLayoutCarrying = {
  kept: authLayout,
  steps: authLayoutSteps,
  tables: [sessionsTable, peopleTable],
};

export async function authStoreOpened(database: AuthDatabase): Promise<AuthStore> {
  const outsideAnyTransaction = ambientTransactionSuppressed(database);
  await authLayoutKept(outsideAnyTransaction, theStoreKept);
  await outsideAnyTransaction.migrated([...sessionTables, ...peopleTables]);
  return {
    sessionRows: storedSessionRows(outsideAnyTransaction),
    peopleRows: storedPeopleRows(outsideAnyTransaction),
  };
}
