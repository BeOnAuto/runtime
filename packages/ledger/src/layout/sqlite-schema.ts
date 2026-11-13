import { sqliteContent } from '../content/content-dialects.ts';
import { inTransactionOf, type StatementExecutor, type TransactionalPool } from '../event-store.ts';
import type { NamedProjection } from '../projections/projection-fill.ts';
import { createSQLitePlaybookIndexes } from '../recorded/sqlite-indexes.ts';
import { sqliteLayout } from './layout-dialects.ts';
import { requireTheLayoutKept } from './layout-kept.ts';
import { layoutCarryingBy, type CarriedTables, type LayoutCarrying } from './layout-steps.ts';
import { createdOwnTables } from './own-tables.ts';

export function sqliteLayoutCarried(
  pool: TransactionalPool,
  projected: readonly NamedProjection[],
  carrying: LayoutCarrying,
): Promise<void> {
  return requireTheLayoutKept(inTransactionOf(pool), sqliteLayout, projected, carrying);
}

export function sqliteLayoutKept(
  pool: TransactionalPool,
  projected: readonly NamedProjection[],
  carried?: CarriedTables,
): Promise<void> {
  return sqliteLayoutCarried(pool, projected, layoutCarryingBy(carried));
}

export async function sqliteSchemaCreated(execute: StatementExecutor): Promise<void> {
  await createSQLitePlaybookIndexes(execute);
  await createdOwnTables(execute, sqliteContent);
}
