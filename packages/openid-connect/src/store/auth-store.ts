import type { SessionRows } from '../sessions/session-rows.ts';
import { sessionsTable, sessionTables, storedSessionRows } from '../sessions/stored-session-rows.ts';
import { ambientTransactionSuppressed, type AuthDatabase } from './auth-database.ts';
import { authLayout, authLayoutKept, authLayoutSteps, type AuthLayoutCarrying } from './auth-layout.ts';

export interface AuthStore {
  readonly sessionRows: SessionRows;
}

const theStoreKept: AuthLayoutCarrying = { kept: authLayout, steps: authLayoutSteps, tables: [sessionsTable] };

export async function authStoreOpened(database: AuthDatabase): Promise<AuthStore> {
  const outsideAnyTransaction = ambientTransactionSuppressed(database);
  await authLayoutKept(outsideAnyTransaction, theStoreKept);
  await outsideAnyTransaction.migrated(sessionTables);
  return { sessionRows: storedSessionRows(outsideAnyTransaction) };
}
