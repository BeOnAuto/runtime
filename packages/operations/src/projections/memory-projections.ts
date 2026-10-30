import { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import { streamPrefixOfPlaybook } from '../ledger/bound-ports.ts';
import type { Context } from '../ledger/context.ts';
import { messageIdOf } from '../ledger/message-lineage.ts';
import {
  playbookStreamOf,
  checkedProjection,
  requireAdvancedColumns,
  rowKeyColumn,
  rowKeyOf,
  type PlaybookStream,
  type DueRowsQuery,
  type KeyedProjection,
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

export interface MemoryProjections extends ProjectionReader, ProjectionAdvancer {
  readonly project: (stream: string, facts: readonly AppendedFact[], firstPosition: number) => void;
}

interface Table {
  readonly projection: KeyedProjection;
  readonly rows: Map<string, ProjectedKeyedRow>;
}

const nothingKept: ReadonlyMap<string, ProjectedKeyedRow> = new Map();

function keyedRowOf({ playbook }: PlaybookStream, key: string, row: ProjectedRow): ProjectedKeyedRow {
  return { ...playbook, key, row };
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

function playbookOf(
  rows: ReadonlyMap<string, ProjectedKeyedRow>,
  playbook: { readonly org: string; readonly playbook: string },
): readonly ProjectedKeyedRow[] {
  return [...rows.values()].filter((kept) => kept.org === playbook.org && kept.playbook === playbook.playbook);
}

interface Staged {
  readonly rows: Map<string, ProjectedKeyedRow>;
  readonly stored: string;
  readonly kept: ProjectedKeyedRow;
}

function keyedMessages(projection: KeyedProjection, named: PlaybookStream, messages: readonly ProjectedMessage[]) {
  return messages
    .filter(({ type }) => projection.types.includes(type))
    .flatMap((message) => {
      const key = rowKeyOf(projection, message, named);
      return key === undefined ? [] : [{ message, key }];
    });
}

function staged({ projection, rows }: Table, named: PlaybookStream, messages: readonly ProjectedMessage[]) {
  const changed = new Map<string, ProjectedKeyedRow>();
  for (const { message, key } of keyedMessages(projection, named, messages)) {
    const stored = `${named.playbookKey}${key}`;
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
    const named = playbookStreamOf(stream);
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

interface Advance {
  readonly playbook: PlaybookAddress;
  readonly key: string;
  readonly advance: RowAdvance;
}

function advancedIn(table: Table | undefined, { playbook, key, advance }: Advance): Effect.Effect<void> {
  return Effect.sync(() => {
    if (table === undefined) {
      return;
    }
    requireAdvancedColumns(table.projection, advance.set);
    const stored = `${streamPrefixOfPlaybook(playbook)}${key}`;
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
        [leftDue, streamPrefixOfPlaybook(left), left.key],
        [rightDue, streamPrefixOfPlaybook(right), right.key],
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
    advanceRow: (projection, playbook, key, advance) => advancedIn(tableNamed(projection), { playbook, key, advance }),
    readProjectedRows: (projection, playbook, query) =>
      Effect.sync(() => pageIn(playbookOf(rowsOf(projection), playbook), query)),
    countProjectedRows: (projection, playbook, where) =>
      Effect.sync(() => playbookOf(rowsOf(projection), playbook).filter((kept) => matches(kept, where)).length),
    readDueRows: (projection, query) => Effect.sync(() => dueRowsIn(rowsOf(projection), query)),
    nextDueOf: (projection, column, after) =>
      Effect.sync(() => {
        const due = [...rowsOf(projection).values()].flatMap((kept) => dueOf(kept, column)).filter((at) => at > after);
        return due.length === 0 ? null : Math.min(...due);
      }),
  };
}
