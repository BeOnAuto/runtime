import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { columnRowsOf, tablesOf, type DatabaseStructure } from './database-structure.ts';

const columnsOfEveryTable = SQL`SELECT m.name AS "table", p.name AS name, p.type AS type, p."notnull" AS required,
    p.dflt_value AS fallback, p.pk AS place
  FROM sqlite_master m, pragma_table_info(m.name) p
  WHERE m.type = 'table' AND m.name NOT GLOB 'sqlite_*'
  ORDER BY m.name, p.cid`;

const indexesOfEveryTable = SQL`SELECT l.name AS name, i.sql AS definition,
    (SELECT group_concat(c.name, ', ') FROM (SELECT name FROM pragma_index_info(l.name) ORDER BY seqno) c) AS columns
  FROM sqlite_master m, pragma_index_list(m.name) l
  LEFT JOIN sqlite_master i ON i.type = 'index' AND i.name = l.name
  WHERE m.type = 'table' AND m.name NOT GLOB 'sqlite_*'
  ORDER BY l.name`;

const PlacesSchema = Schema.Array(Schema.Struct({ table: Schema.String, name: Schema.String, place: Schema.Number }));

const IndexRowsSchema = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    definition: Schema.NullOr(Schema.String),
    columns: Schema.NullOr(Schema.String),
  }),
);

function normalized(definition: string): string {
  return definition
    .replaceAll('"', '')
    .replaceAll(/\s+/gu, ' ')
    .replaceAll('( ', '(')
    .replaceAll(' )', ')')
    .replace('IF NOT EXISTS ', '');
}

function definitionOf({ definition, columns }: (typeof IndexRowsSchema.Type)[number]): string {
  return definition === null ? `UNIQUE (${String(columns)})` : normalized(definition);
}

export async function sqliteStructureOf(execute: StatementExecutor): Promise<DatabaseStructure> {
  const { rows: columns } = await execute.query(columnsOfEveryTable);
  const { rows: indexes } = await execute.query(indexesOfEveryTable);
  const keys = Schema.decodeUnknownSync(PlacesSchema)(columns)
    .filter(({ place }) => place > 0)
    .toSorted((one, other) => one.place - other.place);
  return {
    tables: tablesOf(columnRowsOf(columns), keys),
    indexes: Object.fromEntries(
      Schema.decodeUnknownSync(IndexRowsSchema)(indexes).map((index) => [index.name, definitionOf(index)]),
    ),
  };
}
