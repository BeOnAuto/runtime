import { Effect } from 'effect';

import type { Context } from '../ledger/context.ts';
import { messageIdOf } from '../ledger/message-lineage.ts';
import {
  addressedStreamOf,
  advancedColumnsOf,
  checkedProjection,
  requireAdvancedColumns,
  rowKeyColumn,
  rowKeyOf,
  streamPrefixOfAddress,
  type AddressedStream,
  type DueRowsQuery,
  type KeyedProjection,
  type ProjectedAddress,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type ProjectedMessage,
  type ProjectedRow,
  type ProjectedRowsQuery,
  type ProjectedValue,
  type ProjectionAdvancer,
  type ProjectionReader,
  type RowAdvance,
} from './keyed-projection.ts';

export interface AppendedFact {
  readonly type: string;
  readonly data: unknown;
  readonly context: Context;
}

export interface LoggedFact extends AppendedFact {
  readonly stream: string;
  readonly streamPosition: number;
}

interface FactRewritten {
  readonly stream: string;
  readonly before: ProjectedMessage;
  readonly after: ProjectedMessage;
}

export interface MemoryProjections extends ProjectionReader, ProjectionAdvancer {
  readonly project: (stream: string, facts: readonly AppendedFact[], firstPosition: number) => void;
  readonly refold: (log: readonly LoggedFact[], rewritten: FactRewritten) => void;
}

interface Table {
  readonly projection: KeyedProjection;
  readonly rows: Map<string, ProjectedKeyedRow>;
}

const nothingKept: ReadonlyMap<string, ProjectedKeyedRow> = new Map();

function keyedRowOf({ address }: AddressedStream, key: string, row: ProjectedRow): ProjectedKeyedRow {
  return { ...address, key, row };
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

function matches({ row, key }: ProjectedKeyedRow, where: readonly ProjectedCondition[]): boolean {
  return where.every(({ column, equals }) => (column === rowKeyColumn ? key : row[column]) === equals);
}

function rowsAt(rows: ReadonlyMap<string, ProjectedKeyedRow>, address: ProjectedAddress): readonly ProjectedKeyedRow[] {
  return [...rows.values()].filter((kept) => kept.org === address.org && kept.playbook === address.playbook);
}

interface Staged {
  readonly rows: Map<string, ProjectedKeyedRow>;
  readonly stored: string;
  readonly kept: ProjectedKeyedRow;
}

function keyedMessages(projection: KeyedProjection, named: AddressedStream, messages: readonly ProjectedMessage[]) {
  return messages
    .filter(({ type }) => projection.types.includes(type))
    .flatMap((message) => {
      const key = rowKeyOf(projection, message, named);
      return key === undefined ? [] : [{ message, key }];
    });
}

function staged({ projection, rows }: Table, named: AddressedStream, messages: readonly ProjectedMessage[]) {
  const changed = new Map<string, ProjectedKeyedRow>();
  for (const { message, key } of keyedMessages(projection, named, messages)) {
    const stored = `${named.prefix}${key}`;
    const row = (changed.get(stored) ?? rows.get(stored))?.row;
    const next = projection.rowAfter(row, message);
    if (next !== undefined) {
      changed.set(stored, keyedRowOf(named, key, next));
    }
  }
  return [...changed].map(([stored, kept]: readonly [string, ProjectedKeyedRow]): Staged => ({ rows, stored, kept }));
}

function dueOf({ row }: ProjectedKeyedRow, column: string): readonly number[] {
  const due = row[column];
  return typeof due === 'number' ? [due] : [];
}

function orderedKeyOf(orderBy: readonly string[], { row, key }: ProjectedKeyedRow): readonly Ordered[] {
  return [...orderBy.map((column) => row[column]), key];
}

export function projectedMessagesOf(
  stream: string,
  facts: readonly AppendedFact[],
  firstPosition: number,
): readonly ProjectedMessage[] {
  return facts.map(({ type, data, context }, index) => {
    const position = firstPosition + index;
    return { id: messageIdOf(stream, position), position, type, data, context };
  });
}

function projectedOn(tables: readonly Table[]): MemoryProjections['project'] {
  return (stream, facts, firstPosition) => {
    const named = addressedStreamOf(stream);
    if (named === undefined) {
      return;
    }
    const messages = projectedMessagesOf(stream, facts, firstPosition);
    const changes = tables.flatMap((table) => staged(table, named, messages));
    for (const { rows, stored, kept } of changes) {
      rows.set(stored, kept);
    }
  };
}

function messagesOfTheRow(
  projection: KeyedProjection,
  log: readonly LoggedFact[],
  { prefix }: AddressedStream,
  key: string,
): readonly ProjectedMessage[] {
  return log.flatMap(({ stream, streamPosition, type, data, context }) => {
    const named = addressedStreamOf(stream);
    const message = { id: messageIdOf(stream, streamPosition), position: streamPosition, type, data, context };
    const folds =
      named?.prefix === prefix && projection.types.includes(type) && rowKeyOf(projection, message, named) === key;
    return folds ? [message] : [];
  });
}

function foldedRow(projection: KeyedProjection, messages: readonly ProjectedMessage[]): ProjectedRow | undefined {
  let row: ProjectedRow | undefined;
  for (const message of messages) {
    row = projection.rowAfter(row, message) ?? row;
  }
  return row;
}

function standingIn(projection: KeyedProjection, kept: ProjectedKeyedRow | undefined): ProjectedRow {
  return kept === undefined
    ? {}
    : Object.fromEntries(advancedColumnsOf(projection).map((column) => [column, kept.row[column] ?? null]));
}

function refoldedIn({ projection, rows }: Table, log: readonly LoggedFact[], named: AddressedStream, key: string) {
  const stored = `${named.prefix}${key}`;
  const row = foldedRow(projection, messagesOfTheRow(projection, log, named, key));
  if (row === undefined) {
    rows.delete(stored);
    return;
  }
  rows.set(stored, keyedRowOf(named, key, { ...row, ...standingIn(projection, rows.get(stored)) }));
}

function refoldedOn(tables: readonly Table[]): MemoryProjections['refold'] {
  return (log, { stream, before, after }) => {
    const named = addressedStreamOf(stream);
    if (named === undefined) {
      return;
    }
    for (const table of tables.filter(({ projection }) => projection.types.includes(before.type))) {
      const keys = new Set([rowKeyOf(table.projection, before, named), rowKeyOf(table.projection, after, named)]);
      for (const key of [...keys].filter((each) => each !== undefined)) {
        refoldedIn(table, log, named, key);
      }
    }
  };
}

interface Advance {
  readonly address: ProjectedAddress;
  readonly key: string;
  readonly advance: RowAdvance;
}

function advancedIn(table: Table | undefined, { address, key, advance }: Advance): Effect.Effect<void> {
  return Effect.sync(() => {
    if (table === undefined) {
      return;
    }
    requireAdvancedColumns(table.projection, advance.set);
    const stored = `${streamPrefixOfAddress(address)}${key}`;
    const kept = table.rows.get(stored);
    if (kept !== undefined && matches(kept, advance.when)) {
      table.rows.set(stored, { ...kept, row: { ...kept.row, ...advance.set } });
    }
  });
}

function dueRowsIn(rows: ReadonlyMap<string, ProjectedKeyedRow>, { column, through, limit }: DueRowsQuery) {
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

function pageIn(
  rows: readonly ProjectedKeyedRow[],
  { where, orderBy, order, after, limit }: ProjectedRowsQuery,
): readonly ProjectedKeyedRow[] {
  const sign = order === 'asc' ? 1 : -1;
  return rows
    .filter((kept) => matches(kept, where))
    .filter((kept) => after === undefined || sign * tupleCompared(orderedKeyOf(orderBy, kept), after) > 0)
    .toSorted((left, right) => sign * tupleCompared(orderedKeyOf(orderBy, left), orderedKeyOf(orderBy, right)))
    .slice(0, limit);
}

export function memoryProjections(projections: readonly KeyedProjection[]): MemoryProjections {
  const tables: readonly Table[] = projections.map((projection) => ({
    projection: checkedProjection(projection),
    rows: new Map(),
  }));
  const tableNamed = (name: string): Table | undefined => tables.find(({ projection }) => projection.name === name);
  const rowsOf = (name: string): ReadonlyMap<string, ProjectedKeyedRow> => tableNamed(name)?.rows ?? nothingKept;
  return {
    project: projectedOn(tables),
    refold: refoldedOn(tables),
    advanceRow: (projection, address, key, advance) => advancedIn(tableNamed(projection), { address, key, advance }),
    readProjectedRows: (projection, address, query) =>
      Effect.sync(() => pageIn(rowsAt(rowsOf(projection), address), query)),
    countProjectedRows: (projection, address, where) =>
      Effect.sync(() => rowsAt(rowsOf(projection), address).filter((kept) => matches(kept, where)).length),
    readDueRows: (projection, query) => Effect.sync(() => dueRowsIn(rowsOf(projection), query)),
    nextDueOf: (projection, column, after) =>
      Effect.sync(() => {
        const due = [...rowsOf(projection).values()].flatMap((kept) => dueOf(kept, column)).filter((at) => at > after);
        return due.length === 0 ? null : Math.min(...due);
      }),
  };
}
