import { pooledOptionsOf, type AnyDriver, type SQLiteStoreOptions } from '../sqlite-event-store.ts';
import type { LedgerReads } from './ledger-connection.ts';
import { sqlOf } from './statement.ts';

export function sqliteLedgerReadsOn<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
): LedgerReads {
  const { pool } = pooledOptionsOf(optionsOf);
  return {
    read: async (asked) => (await pool.execute.query(sqlOf(asked))).rows,
    close: () => pool.close(),
  };
}
