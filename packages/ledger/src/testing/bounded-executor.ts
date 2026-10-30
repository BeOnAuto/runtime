import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';

import type { StatementExecutor } from '../event-store.ts';

export function boundedExecutor(execute: StatementExecutor, mostBoundValues: number): StatementExecutor {
  const withinTheBound = <A>(sql: SQL, run: (sql: SQL) => Promise<A>): Promise<A> =>
    SQL.format(sql, sqliteFormatter).params.length > mostBoundValues
      ? Promise.reject(new Error('too many SQL variables'))
      : run(sql);
  return {
    query: (sql) => withinTheBound(sql, execute.query),
    command: (sql) => withinTheBound(sql, execute.command),
  };
}
