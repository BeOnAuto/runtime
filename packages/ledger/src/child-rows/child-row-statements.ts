import { SQL } from '@event-driven-io/dumbo';
import { childKeyColumn, type ProjectedRow, type ProjectedRows, type ProjectionDeclaration } from '@on.auto/operations';
import { Schema } from 'effect';

import { chunksOf } from '../connection/bound-values.ts';
import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import {
  childKeyColumns,
  rowDelete,
  rowFrom,
  rowsFrom,
  selectedColumns,
  tableOf,
  valuesOf,
  type KeptRow,
  type RowPlace,
} from '../projections/projection-statements.ts';

export interface KeptChildRows extends RowPlace {
  readonly rows: ProjectedRows;
}

export interface KeptChildRow extends KeptRow {
  readonly child: string;
}

const decodeChildKey = Schema.decodeUnknownSync(Schema.String);

export async function childRowsIn(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  projection: ProjectionDeclaration,
  { prefix, key }: RowPlace,
): Promise<ProjectedRows> {
  const { rows } = await execute.query(
    SQL`SELECT child_key, ${selectedColumns(dialect, projection)} FROM ${tableOf(projection)}
      WHERE playbook_key = ${prefix} AND row_key = ${key} ORDER BY child_key`,
  );
  return new Map(
    rowsFrom(rows).map((stored): readonly [string, ProjectedRow] => [
      decodeChildKey(stored[childKeyColumn]),
      rowFrom(projection, stored),
    ]),
  );
}

function childValuesOf(dialect: ProjectionDialect, projection: ProjectionDeclaration, kept: KeptChildRow): SQL {
  const columns = [{ name: childKeyColumn, kind: 'text' } as const, ...projection.columns];
  return valuesOf(dialect, { columns }, { ...kept, row: { ...kept.row, [childKeyColumn]: kept.child } });
}

export function childRowsOf({ prefix, key, rows }: KeptChildRows): readonly KeptChildRow[] {
  return [...rows].map(([child, row]: readonly [string, ProjectedRow]) => ({ prefix, key, child, row }));
}

export function childRowsWrite(
  dialect: ProjectionDialect,
  projection: ProjectionDeclaration,
  kept: readonly KeptChildRow[],
): SQL {
  const columns = SQL.plain([...childKeyColumns, ...projection.columns.map(({ name }) => name)].join(', '));
  const values = SQL.merge(
    kept.map((each) => childValuesOf(dialect, projection, each)),
    ', ',
  );
  return SQL`INSERT INTO ${tableOf(projection)} (${columns}) VALUES ${values}`;
}

export function childRowsInAWrite(dialect: ProjectionDialect, projection: ProjectionDeclaration): number {
  return dialect.rowsInAWrite(projection.columns.length + 1);
}

interface ChildRowsKeeping {
  readonly dialect: ProjectionDialect;
  readonly projection: ProjectionDeclaration;
}

export async function childRowsReplaced(
  { dialect, projection }: ChildRowsKeeping,
  execute: StatementExecutor,
  kept: KeptChildRows,
): Promise<void> {
  await execute.command(rowDelete(projection, kept));
  await inTurn(chunksOf(childRowsOf(kept), childRowsInAWrite(dialect, projection)), (rows) =>
    execute.command(childRowsWrite(dialect, projection, rows)),
  );
}
