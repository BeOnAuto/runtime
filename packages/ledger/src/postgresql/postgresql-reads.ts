import type { LedgerStore } from '../event-store.ts';
import { postgresqlLogOn } from '../log/postgresql-log.ts';
import type { Query } from '../postgresql-reads/postgresql-recorded.ts';
import type { PostgreSQLOptions } from './postgresql-options.ts';
import { postgresqlRunOutcomesOf } from './postgresql-run-outcomes.ts';

export function postgresqlReadsOn(
  kept: Pick<PostgreSQLOptions, 'runOutcomes'>,
  query: Query,
): Pick<LedgerStore, 'readRunOutcomes' | 'log'> {
  return { readRunOutcomes: postgresqlRunOutcomesOf(kept.runOutcomes, query), log: postgresqlLogOn(query) };
}
