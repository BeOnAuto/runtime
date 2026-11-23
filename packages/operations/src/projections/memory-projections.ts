import { Effect, Function } from 'effect';

import type { Context } from '../ledger/context.ts';
import { messageIdOf } from '../ledger/message-lineage.ts';
import {
  addressedStreamOf,
  advancedColumnsLeftBy,
  advancedColumnsOf,
  keepsChildRows,
  partitionOfTheRow,
  requireAdvancedColumns,
  rowKeyOf,
  streamPrefixOfAddress,
  type AddressedStream,
  type ChildRowsProjection,
  type KeptProjection,
  type KeyedProjection,
  type ProjectedAddress,
  type ProjectedKeyedRow,
  type ProjectedMessage,
  type ProjectedRow,
  type ProjectedRows,
  type ProjectionAdvancer,
  type ProjectionReader,
  type RowAdvance,
} from './keyed-projection.ts';
import {
  childRowsReplaced,
  childRowsUnder,
  countIn,
  dueOf,
  dueRowsIn,
  keyedRowOf,
  nothingKept,
  pageIn,
  placementsOf,
  rowsOfKeysIn,
  type DefinitionsOfAPlaybook,
  type PlaybookOfADefinition,
  type Table,
  type TableOf,
} from './memory-rows.ts';
import { conditionsMetBy } from './projected-conditions.ts';
import { checkedProjection } from './projection-checks.ts';

export interface AppendedFact {
  readonly type: string;
  readonly data: unknown;
  readonly context: Context;
  readonly payloadBytes?: number;
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
  readonly staged: (stream: string, facts: readonly AppendedFact[], firstPosition: number) => () => void;
  readonly refold: (log: readonly LoggedFact[], rewritten: FactRewritten) => void;
}

type Staged = () => void;

function keyedMessages(projection: KeptProjection, named: AddressedStream, messages: readonly ProjectedMessage[]) {
  return messages
    .filter(({ type }) => projection.types.includes(type))
    .flatMap((message) => {
      const key = rowKeyOf(projection, message, named);
      return key === undefined ? [] : [{ message, key }];
    });
}

function leftStandingIn(projection: KeyedProjection, row: ProjectedRow | undefined, type: string): ProjectedRow {
  return row === undefined
    ? {}
    : Object.fromEntries(advancedColumnsLeftBy(projection, type).map((column) => [column, row[column] ?? null]));
}

function stagedRows(
  { projection, rows }: TableOf<KeyedProjection>,
  named: AddressedStream,
  messages: readonly ProjectedMessage[],
): readonly Staged[] {
  const changed = new Map<string, ProjectedKeyedRow>();
  for (const { message, key } of keyedMessages(projection, named, messages)) {
    const stored = `${named.prefix}${key}`;
    const row = (changed.get(stored) ?? rows.get(stored))?.row;
    const next = projection.rowAfter(row, message);
    if (next !== undefined) {
      changed.set(stored, keyedRowOf(named, key, { ...next, ...leftStandingIn(projection, row, message.type) }));
    }
  }
  return [...changed].map(([stored, kept]: readonly [string, ProjectedKeyedRow]): Staged => () => {
    rows.set(stored, kept);
  });
}

function stagedChildRows(
  table: TableOf<ChildRowsProjection>,
  named: AddressedStream,
  messages: readonly ProjectedMessage[],
): readonly Staged[] {
  const changed = new Map<string, ProjectedRows>();
  for (const { message, key } of keyedMessages(table.projection, named, messages)) {
    const next = table.projection.rowsAfter(changed.get(key) ?? childRowsUnder(table, named, key), message);
    if (next !== undefined) {
      changed.set(key, next);
    }
  }
  return [...changed].map(([key, after]: readonly [string, ProjectedRows]): Staged => () => {
    childRowsReplaced(table, named, key, after);
  });
}

function staged(table: Table, stream: AddressedStream, messages: readonly ProjectedMessage[]): readonly Staged[] {
  const { projection, rows } = table;
  const named = partitionOfTheRow(projection, stream);
  return keepsChildRows(projection)
    ? stagedChildRows({ projection, rows }, named, messages)
    : stagedRows({ projection, rows }, named, messages);
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

function projectedOn(tables: readonly Table[]): MemoryProjections['staged'] {
  return (stream, facts, firstPosition) => {
    const named = addressedStreamOf(stream);
    if (named === undefined) {
      return Function.constVoid;
    }
    const messages = projectedMessagesOf(stream, facts, firstPosition);
    const changes = tables.flatMap((table) => staged(table, named, messages));
    return () => {
      for (const commit of changes) {
        commit();
      }
    };
  };
}

function messagesOfTheRow(
  projection: KeptProjection,
  log: readonly LoggedFact[],
  { prefix }: AddressedStream,
  key: string,
): readonly ProjectedMessage[] {
  return log.flatMap(({ stream, streamPosition, type, data, context }) => {
    const named = addressedStreamOf(stream);
    const message = { id: messageIdOf(stream, streamPosition), position: streamPosition, type, data, context };
    const folds =
      named !== undefined &&
      partitionOfTheRow(projection, named).prefix === prefix &&
      projection.types.includes(type) &&
      rowKeyOf(projection, message, named) === key;
    return folds ? [message] : [];
  });
}

function foldedRows(projection: ChildRowsProjection, messages: readonly ProjectedMessage[]): ProjectedRows {
  let rows: ProjectedRows = new Map();
  for (const message of messages) {
    rows = projection.rowsAfter(rows, message) ?? rows;
  }
  return rows;
}

function foldedRow(projection: KeyedProjection, messages: readonly ProjectedMessage[]): ProjectedRow | undefined {
  let row: ProjectedRow | undefined;
  for (const message of messages) {
    row = projection.rowAfter(row, message) ?? row;
  }
  return row;
}

function standingIn(projection: KeptProjection, kept: ProjectedKeyedRow | undefined): ProjectedRow {
  return kept === undefined
    ? {}
    : Object.fromEntries(advancedColumnsOf(projection).map((column) => [column, kept.row[column] ?? null]));
}

function refoldedIn(table: Table, log: readonly LoggedFact[], named: AddressedStream, key: string) {
  const { projection, rows } = table;
  if (keepsChildRows(projection)) {
    childRowsReplaced(table, named, key, foldedRows(projection, messagesOfTheRow(projection, log, named, key)));
    return;
  }
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
        refoldedIn(table, log, partitionOfTheRow(table.projection, named), key);
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
    const unchanged = conditionsMetBy(table.projection, advance.when);
    const stored = `${streamPrefixOfAddress(address)}${key}`;
    const kept = table.rows.get(stored);
    if (kept !== undefined && unchanged(kept)) {
      table.rows.set(stored, { ...kept, row: { ...kept.row, ...advance.set } });
    }
  });
}

export function memoryProjections(
  given: readonly KeptProjection[],
  definitionsOf: DefinitionsOfAPlaybook,
  playbookOf: PlaybookOfADefinition,
): MemoryProjections {
  const { placed, placedIn } = placementsOf(definitionsOf, playbookOf);
  const tables: readonly Table[] = given.map((projection) => ({
    projection: checkedProjection(projection),
    rows: new Map(),
  }));
  const tableNamed = (name: string): Table | undefined => tables.find(({ projection }) => projection.name === name);
  const rowsOf = (name: string): ReadonlyMap<string, ProjectedKeyedRow> => tableNamed(name)?.rows ?? nothingKept;
  return {
    staged: projectedOn(tables),
    refold: refoldedOn(tables),
    advanceRow: (projection, address, key, advance) => advancedIn(tableNamed(projection), { address, key, advance }),
    readProjectedRows: (projection, address, query) =>
      Effect.sync(() => {
        const table = tableNamed(projection);
        return table === undefined ? [] : pageIn(table, placed(address), query).map((row) => placedIn(row));
      }),
    readProjectedRowsOfKeys: (projection, address, keys) =>
      Effect.suspend(() => {
        const table = tableNamed(projection);
        return table !== undefined && keepsChildRows(table.projection)
          ? Effect.die(new Error(`A read by keys reads a keyed projection, and ${projection} keeps child rows`))
          : Effect.succeed(
              rowsOfKeysIn(table, placed(address), keys).map((row) => (row === undefined ? undefined : placedIn(row))),
            );
      }),
    readTogether: (reads) => reads,
    countProjectedRows: (projection, address, where) =>
      Effect.sync(() => {
        const table = tableNamed(projection);
        return table === undefined ? 0 : countIn(table, placed(address), where);
      }),
    readDueRows: (projection, query) =>
      Effect.sync(() => dueRowsIn(rowsOf(projection), query).map((row) => placedIn(row))),
    nextDueOf: (projection, column, after) =>
      Effect.sync(() => {
        const due = [...rowsOf(projection).values()].flatMap((kept) => dueOf(kept, column)).filter((at) => at > after);
        return due.length === 0 ? null : Math.min(...due);
      }),
  };
}
