import type { LedgerStore } from '../event-store.ts';
import { postgresqlLogOn } from '../log/postgresql-log.ts';
import type { Query } from '../postgresql-reads/postgresql-recorded.ts';
import type { TablesCatchingUp } from '../projection-catch-up/catching-up.ts';
import type { PostgreSQLOptions } from './postgresql-options.ts';
import { postgresqlRunOutcomesOf } from './postgresql-run-outcomes.ts';

export function postgresqlReadsOn(
  kept: Pick<PostgreSQLOptions, 'runOutcomes'>,
  query: Query,
  catchingUp: TablesCatchingUp,
): Pick<LedgerStore, 'readRunOutcomes' | 'log'> {
  return {
    readRunOutcomes: postgresqlRunOutcomesOf(kept.runOutcomes, query, catchingUp),
    log: postgresqlLogOn(query),
  };
}
