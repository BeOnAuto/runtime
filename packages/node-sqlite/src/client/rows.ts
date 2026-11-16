import type { SQLInputValue, SQLOutputValue, StatementColumnMetadata, StatementSync } from 'node:sqlite';

import type { QueryResultRow } from '@event-driven-io/dumbo';

type ColumnValue = Exclude<SQLOutputValue, Uint8Array> | Buffer | undefined;

export type BoundValues = readonly Readonly<SQLInputValue>[];

function columnValueOf(value: Readonly<SQLOutputValue> | undefined): ColumnValue {
  return value !== null && typeof value === 'object'
    ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    : value;
}

function rowOf(names: readonly string[], valuesInColumnOrder: readonly Readonly<SQLOutputValue>[]): QueryResultRow {
  const row: Record<string, ColumnValue> = {};
  for (const [position, name] of names.entries()) {
    row[name] = columnValueOf(valuesInColumnOrder[position]);
  }
  return row;
}

export function rowsOf(statement: Readonly<StatementSync>, values: BoundValues): QueryResultRow[] {
  const names = statement.columns().map((column: Readonly<StatementColumnMetadata>) => column.name);
  statement.setReturnArrays(true);
  return statement
    .all(...values)
    .map((answered: Readonly<Record<string, Readonly<SQLOutputValue>>>) => rowOf(names, Object.values(answered)));
}
