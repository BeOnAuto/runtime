import { SQL, dumbo, type SQLExecutor } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';

import type { RecordedStore } from '../event-store.ts';
import { sqliteDefinitionStreamsIndexed, sqlitePlanOf } from './sqlite-plans.ts';

export async function executedOn<A>(fileName: string, work: (execute: SQLExecutor) => Promise<A>): Promise<A> {
  const pool = dumbo(sqlite3EventStoreDriver.mapToDumboOptions({ fileName }));
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
