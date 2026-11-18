import { AsyncLocalStorage } from 'node:async_hooks';

import type { ConnectionPorts } from '@on.auto/ledger';

export type AuthDatabase = Pick<ConnectionPorts, 'dialect' | 'read' | 'write' | 'transaction' | 'migrated'>;

export function ambientTransactionSuppressed(database: AuthDatabase): AuthDatabase {
  const outsideAnyTransaction = AsyncLocalStorage.snapshot();
  return {
    dialect: database.dialect,
    read: (asked) => outsideAnyTransaction(() => database.read(asked)),
    write: (asked) => outsideAnyTransaction(() => database.write(asked)),
    transaction: (statements) => outsideAnyTransaction(() => database.transaction(statements)),
    migrated: (statements) => outsideAnyTransaction(() => database.migrated(statements)),
  };
}
