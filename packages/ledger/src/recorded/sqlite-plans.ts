import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';

import { definitionStreamsQuery } from '../definitions/sqlite-definition-streams.ts';
import type { RecordedStore } from '../event-store.ts';
import { sqliteRecordedStore } from './sqlite-recorded.ts';

export async function sqliteDefinitionStreamsIndexed(execute: SQLExecutor): Promise<boolean> {
  const { rows } = await execute.query(SQL`EXPLAIN QUERY PLAN ${definitionStreamsQuery('recall')}`);
  return JSON.stringify(rows).includes('USING INDEX ledger_definition_streams');
}

export async function sqlitePlanOf(
  execute: SQLExecutor,
  read: (store: RecordedStore) => Promise<unknown>,
): Promise<string> {
  const asked: SQL[] = [];
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
}
