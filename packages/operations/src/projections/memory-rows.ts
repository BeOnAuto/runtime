import {
  streamPrefixOfAddress,
  type AddressedStream,
  type DueRowsQuery,
  type KeptProjection,
  type ProjectedAddress,
  type ProjectedKeyedRow,
  type ProjectedRow,
  type ProjectedRows,
  type ProjectedRowsQuery,
  type ProjectedValue,
} from './keyed-projection.ts';
import { conditionsMetBy } from './projected-conditions.ts';

export interface Table {
  readonly projection: KeptProjection;
  readonly rows: Map<string, ProjectedKeyedRow>;
}

export interface TableOf<Projection extends KeptProjection> extends Table {
  readonly projection: Projection;
}

export const nothingKept: ReadonlyMap<string, ProjectedKeyedRow> = new Map();

export function keyedRowOf({ address }: AddressedStream, key: string, row: ProjectedRow): ProjectedKeyedRow {
  return { ...address, key, row };
}

function childStoredOf(prefix: string, key: string, child: string): string {
  return JSON.stringify([prefix, key, child]);
}

function isUnder({ prefix }: AddressedStream, key: string): (kept: ProjectedKeyedRow) => boolean {
  return (kept) => streamPrefixOfAddress(kept) === prefix && kept.key === key;
}

export function childRowsUnder({ rows }: Table, named: AddressedStream, key: string): ProjectedRows {
  const under = isUnder(named, key);
  return new Map(
    [...rows.values()].flatMap((kept): readonly (readonly [string, ProjectedRow])[] =>
      under(kept) && kept.child !== undefined ? [[kept.child, kept.row]] : [],
    ),
  );
}

export function childRowsReplaced({ rows }: Table, named: AddressedStream, key: string, after: ProjectedRows): void {
  const under = isUnder(named, key);
  for (const [stored, kept] of rows) {
    if (under(kept)) {
      rows.delete(stored);
    }
  }
  for (const [child, row] of after) {
    rows.set(childStoredOf(named.prefix, key, child), { ...named.address, key, child, row });
  }
}

type Ordered = ProjectedValue | undefined;

function rankOf(value: Ordered): string | number | boolean {
  return value ?? Number.NEGATIVE_INFINITY;
}

function compared(left: Ordered, right: Ordered): number {
  const first = rankOf(left);
  const second = rankOf(right);
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}

function tupleCompared(left: readonly Ordered[], right: readonly Ordered[]): number {
  for (const [index, value] of left.entries()) {
    const order = compared(value, right[index]);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

export function rowsAt({ rows }: Table, address: ProjectedAddress): readonly ProjectedKeyedRow[] {
  return [...rows.values()].filter((kept) => kept.org === address.org && kept.playbook === address.playbook);
}

export function dueOf({ row }: ProjectedKeyedRow, column: string): readonly number[] {
  const due = row[column];
  return typeof due === 'number' ? [due] : [];
}

function orderedKeyOf(orderBy: readonly string[], { row, key, child }: ProjectedKeyedRow): readonly Ordered[] {
  return [...orderBy.map((column) => row[column]), key, ...(child === undefined ? [] : [child])];
}

export function dueRowsIn(rows: ReadonlyMap<string, ProjectedKeyedRow>, { column, through, limit }: DueRowsQuery) {
  return [...rows.values()]
    .flatMap((kept) => dueOf(kept, column).map((due): readonly [number, ProjectedKeyedRow] => [due, kept]))
    .filter(([due]) => due <= through)
    .toSorted(([leftDue, left], [rightDue, right]) =>
      tupleCompared(
        [leftDue, streamPrefixOfAddress(left), left.key],
        [rightDue, streamPrefixOfAddress(right), right.key],
      ),
    )
    .slice(0, limit)
    .map(([, kept]) => kept);
}

export function pageIn(
  table: Table,
  address: ProjectedAddress,
  { where, orderBy, order, after, limit }: ProjectedRowsQuery,
): readonly ProjectedKeyedRow[] {
  const sign = order === 'asc' ? 1 : -1;
  const met = conditionsMetBy(table.projection, where);
  return rowsAt(table, address)
    .filter((kept) => met(kept))
    .filter((kept) => after === undefined || sign * tupleCompared(orderedKeyOf(orderBy, kept), after) > 0)
    .toSorted((left, right) => sign * tupleCompared(orderedKeyOf(orderBy, left), orderedKeyOf(orderBy, right)))
    .slice(0, limit);
}

export function countIn(table: Table, address: ProjectedAddress, where: ProjectedRowsQuery['where']): number {
  const met = conditionsMetBy(table.projection, where);
  return rowsAt(table, address).filter((kept) => met(kept)).length;
}
