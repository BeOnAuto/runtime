import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';

interface ColumnShape {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly fallback: string | null;
}

export interface TableShape {
  readonly columns: readonly ColumnShape[];
  readonly primaryKey: readonly string[];
}

export interface DatabaseStructure {
  readonly tables: Readonly<Record<string, TableShape>>;
  readonly indexes: Readonly<Record<string, string>>;
}

export type StructureRead = (execute: StatementExecutor) => Promise<DatabaseStructure>;

const ColumnRowsSchema = Schema.Array(
  Schema.Struct({
    table: Schema.String,
    name: Schema.String,
    type: Schema.String,
    required: Schema.Union([Schema.Boolean, Schema.Number]),
    fallback: Schema.NullOr(Schema.String),
  }),
);

export type ColumnRow = (typeof ColumnRowsSchema.Type)[number];

export const columnRowsOf = Schema.decodeUnknownSync(ColumnRowsSchema);

const KeyRowsSchema = Schema.Array(Schema.Struct({ table: Schema.String, name: Schema.String }));

export type KeyRow = (typeof KeyRowsSchema.Type)[number];

export const keyRowsOf = Schema.decodeUnknownSync(KeyRowsSchema);

function isRequired(required: boolean | number): boolean {
  return required === true || required === 1;
}

export function tablesOf(columns: readonly ColumnRow[], keys: readonly KeyRow[]): Readonly<Record<string, TableShape>> {
  return Object.fromEntries(
    [...Map.groupBy(columns, ({ table }) => table)].map(
      ([table, ofTheTable]: readonly [string, readonly ColumnRow[]]) => [
        table,
        {
          columns: ofTheTable.map(({ name, type, required, fallback }) => ({
            name,
            type,
            required: isRequired(required),
            fallback,
          })),
          primaryKey: keys.filter((key) => key.table === table).map(({ name }) => name),
        },
      ],
    ),
  );
}
