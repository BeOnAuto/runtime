import type { SQLExecutor } from '@event-driven-io/dumbo';

import type { LedgerStore } from '../event-store.ts';
import { sqliteLogOn } from '../log/sqlite-log.ts';
import { sqliteRunOutcomesOf } from '../outcomes/sqlite-run-outcomes.ts';
import type { KeptTables } from '../projections/projection-parts.ts';

export function sqliteReadsOn(
  kept: Pick<KeptTables, 'runOutcomes'>,
  execute: SQLExecutor,
): Pick<LedgerStore, 'readRunOutcomes' | 'log'> {
  return {
    readRunOutcomes: sqliteRunOutcomesOf(kept.runOutcomes, execute),
    log: sqliteLogOn(execute),
  };
}
