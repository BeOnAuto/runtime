import { sqliteContent } from '../content/content-dialects.ts';
import { createdContentTables } from '../content/content-tables.ts';
import { inTransactionOf, type StatementExecutor, type TransactionalPool } from '../event-store.ts';
import { createSQLitePlaybookIndexes } from '../recorded/sqlite-indexes.ts';
import { createdSecretTable } from '../secrets/kept-secrets.ts';
import { sqliteLayout } from './layout-dialects.ts';
import { requireTheLayoutKept } from './layout-kept.ts';

export function sqliteLayoutKept(pool: TransactionalPool): Promise<void> {
  return inTransactionOf(pool)((execute) => requireTheLayoutKept(execute, sqliteLayout));
}

export async function sqliteSchemaCreated(execute: StatementExecutor): Promise<void> {
  await createSQLitePlaybookIndexes(execute);
  await createdContentTables(execute, sqliteContent);
  await createdSecretTable(execute, sqliteContent);
}
