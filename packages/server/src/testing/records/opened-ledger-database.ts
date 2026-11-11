import { Effect, ManagedRuntime } from 'effect';
import { onTestFinished } from 'vitest';

import type { LedgerDatabase } from '../../database/ledger-database.ts';
import { sqliteLedgerDatabase } from '../../database/sqlite-ledger-database.ts';

export async function sqliteLedgerDatabaseOpened(fileName: string): Promise<LedgerDatabase> {
  const database = sqliteLedgerDatabase(fileName);
  const runtime = ManagedRuntime.make(database.ledgerLayer({}));
  await runtime.runPromise(Effect.void);
  onTestFinished(() => runtime.dispose());
  return database;
}
