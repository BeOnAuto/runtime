import { Option } from 'effect';

import { playbookOfStreamPrefix, streamPrefixOfTheDefinitionsOf } from '../ledger/bound-ports.ts';
import {
  streamPrefixOfAddress,
  type AddressedStream,
  type DueRowsQuery,
  type KeptProjection,
  type ProjectedKeyedRow,
  type ProjectedRow,
  type ProjectedRows,
  type ProjectedRowsQuery,
  type ProjectedValue,
  type RowsAddress,
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

export type Placed = (kept: ProjectedKeyedRow) => boolean;

function placedUnder(prefixes: readonly string[]): Placed {
  const under = new Set(prefixes);
  return (kept) => under.has(streamPrefixOfAddress(kept));
}

function rowsPlaced({ rows }: Table, placed: Placed): readonly ProjectedKeyedRow[] {
  return [...rows.values()].filter((kept) => placed(kept));
}

export function dueOf({ row }: ProjectedKeyedRow, column: string): readonly number[] {
  const due = row[column];
  return typeof due === 'number' ? [due] : [];
}

function orderedKeyOf(orderBy: readonly string[], { row, key, child }: ProjectedKeyedRow): readonly Ordered[] {
  return [...orderBy.map((column) => row[column]), key, ...(child === undefined ? [] : [child])];
}

function soonestOfEachPlaybook(due: readonly ProjectedKeyedRow[]): readonly ProjectedKeyedRow[] {
  const seen = new Set<string>();
  return due.filter((kept) => {
    const prefix = streamPrefixOfAddress(kept);
    const first = !seen.has(prefix);
    seen.add(prefix);
    return first;
  });
}

export function dueRowsIn(rows: ReadonlyMap<string, ProjectedKeyedRow>, query: DueRowsQuery) {
  const { column, through, limit, onePerPlaybook = false } = query;
  const due = [...rows.values()]
    .flatMap((kept) => dueOf(kept, column).map((at): readonly [number, ProjectedKeyedRow] => [at, kept]))
    .filter(([at]) => at <= through)
    .toSorted(([leftDue, left], [rightDue, right]) =>
      tupleCompared(
        [leftDue, streamPrefixOfAddress(left), left.key],
        [rightDue, streamPrefixOfAddress(right), right.key],
      ),
    )
    .map(([, kept]) => kept);
  return (onePerPlaybook ? soonestOfEachPlaybook(due) : due).slice(0, limit);
}

export function pageIn(
  table: Table,
  placed: Placed,
  { where, orderBy, order, after, limit }: ProjectedRowsQuery,
): readonly ProjectedKeyedRow[] {
  const sign = order === 'asc' ? 1 : -1;
  const met = conditionsMetBy(table.projection, where);
  return rowsPlaced(table, placed)
    .filter((kept) => met(kept))
    .filter((kept) => after === undefined || sign * tupleCompared(orderedKeyOf(orderBy, kept), after) > 0)
    .toSorted((left, right) => sign * tupleCompared(orderedKeyOf(orderBy, left), orderedKeyOf(orderBy, right)))
    .slice(0, limit);
}

export function rowsOfKeysIn(
  table: Table | undefined,
  placed: Placed,
  keys: readonly string[],
): readonly (ProjectedKeyedRow | undefined)[] {
  const byKey = new Map(table === undefined ? [] : rowsPlaced(table, placed).map((kept) => [kept.key, kept]));
  return keys.map((key) => byKey.get(key));
}

export function countIn(table: Table, placed: Placed, where: ProjectedRowsQuery['where']): number {
  const met = conditionsMetBy(table.projection, where);
  return rowsPlaced(table, placed).filter((kept) => met(kept)).length;
}

export type PlaybookOfADefinition = (definitionKey: string) => string | undefined;

function withItsPlaybook(playbookOf: PlaybookOfADefinition): (row: ProjectedKeyedRow) => ProjectedKeyedRow {
  return (row) =>
    Option.match(
      Option.fromNullishOr(row.definition).pipe(
        Option.flatMap(() => Option.fromNullishOr(playbookOf(streamPrefixOfAddress(row)))),
        Option.flatMap(playbookOfStreamPrefix),
      ),
      { onNone: () => row, onSome: ({ playbook }) => ({ ...row, playbook }) },
    );
}

export type DefinitionsOfAPlaybook = (playbookKey: string) => readonly string[];

function placedInThePlaybooksOf(org: string, playbookOf: PlaybookOfADefinition): Placed {
  const definitions = streamPrefixOfTheDefinitionsOf({ org });
  return (kept) => {
    const prefix = streamPrefixOfAddress(kept);
    return prefix.startsWith(definitions) && playbookOf(prefix) !== undefined;
  };
}

function placedAt(definitionsOf: DefinitionsOfAPlaybook, playbookOf: PlaybookOfADefinition) {
  return (address: RowsAddress): Placed => {
    if (address.definitions === 'every') {
      return placedInThePlaybooksOf(address.org, playbookOf);
    }
    const prefix = streamPrefixOfAddress(address);
    return placedUnder([prefix, ...definitionsOf(prefix)]);
  };
}

export function placementsOf(definitionsOf: DefinitionsOfAPlaybook, playbookOf: PlaybookOfADefinition) {
  return { placed: placedAt(definitionsOf, playbookOf), placedIn: withItsPlaybook(playbookOf) };
}
