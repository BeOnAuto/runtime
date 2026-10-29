import type { KeyedProjection } from '@on.auto/operations';

import { inTransactionOn, type ContentConnections } from '../content/postgresql-content.ts';
import type { InTransaction } from '../event-store.ts';
import { postgresqlLayout } from '../layout/layout-dialects.ts';
import { requireTheLayoutKept } from '../layout/layout-kept.ts';
import { layoutCarryingBy, type CarriedTables, type LayoutCarrying } from '../layout/layout-steps.ts';
import { migrationLockTakenWithin } from './postgresql-run-outcomes.ts';

export const migrationLockTaken = migrationLockTakenWithin();

function underTheMigrationLock(connections: ContentConnections): InTransaction {
  const inTransaction = inTransactionOn(connections);
  return (work) =>
    inTransaction(async (execute) => {
      await migrationLockTaken({ execute });
      return work(execute);
    });
}

export function postgresqlLayoutCarried(
  connections: ContentConnections,
  projected: readonly KeyedProjection[],
  carrying: LayoutCarrying,
): Promise<void> {
  return requireTheLayoutKept(underTheMigrationLock(connections), postgresqlLayout, projected, carrying);
}

export function postgresqlLayoutKept(
  connections: ContentConnections,
  projected: readonly KeyedProjection[],
  carried?: CarriedTables,
): Promise<void> {
  return postgresqlLayoutCarried(connections, projected, layoutCarryingBy(carried));
}
