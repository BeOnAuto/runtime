import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { columnRowsOf, keyRowsOf, tablesOf, type DatabaseStructure } from './database-structure.ts';

const columnsOfEveryTable = SQL`SELECT table_name AS "table", column_name AS name, udt_name AS type,
    is_nullable = 'NO' AS required, column_default AS fallback
  FROM information_schema.columns
  WHERE table_schema = current_schema()
  ORDER BY table_name, ordinal_position`;

const primaryKeysOfEveryTable = SQL`SELECT t.table_name AS "table", k.column_name AS name
  FROM information_schema.table_constraints t
  JOIN information_schema.key_column_usage k
    ON k.constraint_schema = t.constraint_schema AND k.constraint_name = t.constraint_name AND k.table_name = t.table_name
  WHERE t.table_schema = current_schema() AND t.constraint_type = 'PRIMARY KEY'
  ORDER BY t.table_name, k.ordinal_position`;

const indexesOfEveryTable = SQL`SELECT indexname AS name, indexdef AS definition
  FROM pg_indexes
  WHERE schemaname = current_schema()
  ORDER BY indexname`;

const IndexRowsSchema = Schema.Array(Schema.Struct({ name: Schema.String, definition: Schema.String }));

export async function postgresqlStructureOf(execute: StatementExecutor): Promise<DatabaseStructure> {
  const { rows: columns } = await execute.query(columnsOfEveryTable);
  const { rows: keys } = await execute.query(primaryKeysOfEveryTable);
  const { rows: indexes } = await execute.query(indexesOfEveryTable);
  return {
    tables: tablesOf(columnRowsOf(columns), keyRowsOf(keys)),
    indexes: Object.fromEntries(
      Schema.decodeUnknownSync(IndexRowsSchema)(indexes).map(({ name, definition }) => [name, definition]),
    ),
  };
}
