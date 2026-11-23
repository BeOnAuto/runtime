import { Effect } from 'effect';

import type { ProjectedKeyedRow, ProjectedRowsQuery, ProjectedValue } from './keyed-projection.ts';

export const rowsReadAtOnce = 100;

type RowsRead = (query: ProjectedRowsQuery) => Effect.Effect<readonly ProjectedKeyedRow[]>;

function afterTheRow(orderBy: readonly string[], { row, key }: ProjectedKeyedRow): readonly ProjectedValue[] {
  return [...orderBy.map((column) => row[column] ?? null), key];
}

function rowsFrom(
  read: RowsRead,
  orderBy: readonly string[],
  atOnce: number,
  after?: readonly ProjectedValue[],
): Effect.Effect<readonly ProjectedKeyedRow[]> {
  const query = { where: [], orderBy, order: 'asc' as const, ...(after === undefined ? {} : { after }), limit: atOnce };
  return Effect.flatMap(read(query), (rows) => {
    const last = rows.at(-1);
    return last === undefined || rows.length < atOnce
      ? Effect.succeed(rows)
      : Effect.map(rowsFrom(read, orderBy, atOnce, afterTheRow(orderBy, last)), (more) => [...rows, ...more]);
  });
}

export function everyProjectedRow(
  read: RowsRead,
  orderBy: readonly string[],
  atOnce: number = rowsReadAtOnce,
): Effect.Effect<readonly ProjectedKeyedRow[]> {
  return rowsFrom(read, orderBy, atOnce);
}
