import { SQL, dumbo, type SQLExecutor } from '@event-driven-io/dumbo';

import { nodeSqliteEventStoreDriver } from '../connection/node-sqlite-event-store-driver.ts';
import type { RecordedStore } from '../event-store.ts';
import { sqliteDefinitionStreamsIndexed, sqlitePlanOf, sqliteStatementPlanOf } from './sqlite-plans.ts';

export async function executedOn<A>(fileName: string, work: (execute: SQLExecutor) => Promise<A>): Promise<A> {
  const pool = dumbo(nodeSqliteEventStoreDriver.mapToDumboOptions({ fileName }));
  try {
    return await work(pool.execute);
  } finally {
    await pool.close();
  }
}

export function queried(fileName: string, statement: string): Promise<readonly unknown[]> {
  return executedOn(fileName, async (execute) => (await execute.query(SQL`${SQL.plain(statement)}`)).rows);
}

export function definitionStreamsIndexed(fileName: string): Promise<boolean> {
  return executedOn(fileName, sqliteDefinitionStreamsIndexed);
}

export function planOf(fileName: string, read: (store: RecordedStore) => Promise<unknown>): Promise<string> {
  return executedOn(fileName, (execute) => sqlitePlanOf(execute, read));
}

export function statementPlanOf(fileName: string, statement: SQL): Promise<string> {
  return executedOn(fileName, (execute) => sqliteStatementPlanOf(execute, statement));
}
