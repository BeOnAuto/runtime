import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';

import type { ReturningExecutor } from '../event-store.ts';

export function boundedExecutor(execute: ReturningExecutor, mostBoundValues: number): ReturningExecutor {
  const withinTheBound = <A>(sql: SQL, run: (sql: SQL) => Promise<A>): Promise<A> =>
    SQL.format(sql, sqliteFormatter).params.length > mostBoundValues
      ? Promise.reject(new Error('too many SQL variables'))
      : run(sql);
  return {
    query: (sql) => withinTheBound(sql, execute.query),
    command: (sql) => withinTheBound(sql, execute.command),
  };
}
