import type { SQLExecutor } from '@event-driven-io/dumbo';

import type { LedgerStore } from '../event-store.ts';
import { sqliteLogOn } from '../log/sqlite-log.ts';
import { sqliteRunOutcomesOf } from '../outcomes/sqlite-run-outcomes.ts';
import type { TablesCatchingUp } from '../projection-catch-up/catching-up.ts';
import type { KeptTables } from '../projections/projection-parts.ts';

export function sqliteReadsOn(
  kept: Pick<KeptTables, 'runOutcomes'>,
  execute: SQLExecutor,
  catchingUp: TablesCatchingUp,
): Pick<LedgerStore, 'readRunOutcomes' | 'log'> {
  return {
    readRunOutcomes: sqliteRunOutcomesOf(kept.runOutcomes, execute, catchingUp),
    log: sqliteLogOn(execute),
  };
}
