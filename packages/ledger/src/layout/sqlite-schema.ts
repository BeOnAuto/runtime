import type { KeyedProjection } from '@on.auto/operations';

import { sqliteContent } from '../content/content-dialects.ts';
import { createdContentTables } from '../content/content-tables.ts';
import { inTransactionOf, type StatementExecutor, type TransactionalPool } from '../event-store.ts';
import { createSQLitePlaybookIndexes } from '../recorded/sqlite-indexes.ts';
import { createdSecretTable } from '../secrets/kept-secrets.ts';
import { sqliteLayout } from './layout-dialects.ts';
import { requireTheLayoutKept } from './layout-kept.ts';
import { layoutCarryingBy, type CarriedTables, type LayoutCarrying } from './layout-steps.ts';

export function sqliteLayoutCarried(
  pool: TransactionalPool,
  projected: readonly KeyedProjection[],
  carrying: LayoutCarrying,
): Promise<void> {
  return requireTheLayoutKept(inTransactionOf(pool), sqliteLayout, projected, carrying);
}

export function sqliteLayoutKept(
  pool: TransactionalPool,
  projected: readonly KeyedProjection[],
  carried?: CarriedTables,
): Promise<void> {
  return sqliteLayoutCarried(pool, projected, layoutCarryingBy(carried));
}

export async function sqliteSchemaCreated(execute: StatementExecutor): Promise<void> {
  await createSQLitePlaybookIndexes(execute);
  await createdContentTables(execute, sqliteContent);
  await createdSecretTable(execute, sqliteContent);
}
