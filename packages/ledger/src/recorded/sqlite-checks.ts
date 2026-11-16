import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';

import type { SQLiteFileDriver } from '../connection/sqlite-file-ledger.ts';
import type { RecordedStore } from '../event-store.ts';
import { pooledOptionsOf } from '../sqlite-event-store.ts';
import { sqliteDefinitionStreamsIndexed, sqlitePlanOf, sqliteStatementPlanOf } from './sqlite-plans.ts';

export interface SQLiteChecks {
  readonly executedOn: <A>(fileName: string, work: (execute: SQLExecutor) => Promise<A>) => Promise<A>;
  readonly queried: (fileName: string, statement: string) => Promise<readonly unknown[]>;
  readonly definitionStreamsIndexed: (fileName: string) => Promise<boolean>;
  readonly planOf: (fileName: string, read: (store: RecordedStore) => Promise<unknown>) => Promise<string>;
  readonly statementPlanOf: (fileName: string, statement: SQL) => Promise<string>;
}

export function sqliteChecksOn(theDriver: () => SQLiteFileDriver): SQLiteChecks {
  const executedOn = async <A>(fileName: string, work: (execute: SQLExecutor) => Promise<A>): Promise<A> => {
    const { pool } = pooledOptionsOf(() => ({ driver: theDriver(), fileName }));
    try {
      return await work(pool.execute);
    } finally {
      await pool.close();
    }
  };
  return {
    executedOn,
    queried: (fileName, statement) =>
      executedOn(fileName, async (execute) => (await execute.query(SQL`${SQL.plain(statement)}`)).rows),
    definitionStreamsIndexed: (fileName) => executedOn(fileName, sqliteDefinitionStreamsIndexed),
    planOf: (fileName, read) => executedOn(fileName, (execute) => sqlitePlanOf(execute, read)),
    statementPlanOf: (fileName, statement) =>
      executedOn(fileName, (execute) => sqliteStatementPlanOf(execute, statement)),
  };
}

export const { executedOn, queried } = sqliteChecksOn(() => sqlite3EventStoreDriver);
