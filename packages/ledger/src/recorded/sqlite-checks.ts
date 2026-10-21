import { SQL, dumbo, type SQLExecutor } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';

import { definitionStreamsQuery } from '../definitions/sqlite-definition-streams.ts';
import type { RecordedStore } from '../event-store.ts';
import { sqliteRecordedStore } from './sqlite-recorded.ts';

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
  return executedOn(fileName, async (execute) => {
    const { rows } = await execute.query(SQL`EXPLAIN QUERY PLAN ${definitionStreamsQuery('recall')}`);
    return JSON.stringify(rows).includes('USING INDEX ledger_definition_streams');
  });
}

export function planOf(fileName: string, read: (store: RecordedStore) => Promise<unknown>): Promise<string> {
  const asked: SQL[] = [];
  return executedOn(fileName, async (execute) => {
    await read(
      sqliteRecordedStore({
        ...execute,
        query: (sql) => {
          asked.push(sql);
          return execute.query(sql);
        },
      }),
    );
    const plans = await execute.batchQuery(asked.map((sql) => SQL`EXPLAIN QUERY PLAN ${sql}`));
    return JSON.stringify(plans);
  });
}
