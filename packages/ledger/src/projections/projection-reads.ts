import { SQL } from '@event-driven-io/dumbo';
import {
  addressOfStreamPrefix,
  childKeyColumn,
  keepsChildRows,
  requireAdvancedColumns,
  streamPrefixOfAddress,
  type DueRowsQuery,
  type KeptProjection,
  type ProjectedAddress,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type ProjectedRowsQuery,
  type ProjectedValue,
  type ProjectionAdvancer,
  type ProjectionReader,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import type { InTransaction } from '../event-store.ts';
import { keptLogged } from '../stream-projections/kept-logs.ts';
import type { Kept } from '../stream-projections/stream-projection-parts.ts';
import { boundOf, type ProjectionDialect } from './projection-dialect.ts';
import {
  columnOf,
  conditionsOf,
  keyColumnsOf,
  rowAdvance,
  rowFrom,
  rowsFrom,
  selectedColumns,
  tableOf,
} from './projection-statements.ts';

type ReadQuery = (sql: SQL) => Promise<readonly unknown[]>;

type WriteCommand = (sql: SQL) => Promise<unknown>;

export interface ProjectionStatements {
  readonly query: ReadQuery;
  readonly command: WriteCommand;
  readonly inTransaction: InTransaction;
}

export interface StreamFreshening {
  readonly fresh: (table: string, address: ProjectedAddress) => Promise<readonly Kept[]>;
  readonly reset: (name: string, address: ProjectedAddress) => Promise<readonly Kept[]>;
}

const KeyFields = Schema.Struct({
  playbook_key: Schema.String,
  row_key: Schema.String,
  child_key: Schema.optionalKey(Schema.String),
});

const decodeKey = Schema.decodeUnknownSync(KeyFields);

const CountRows = Schema.Array(Schema.Struct({ count: Schema.Number }));

const DueRows = Schema.Tuple([Schema.Struct({ due: Schema.NullOr(Schema.Number) })]);

interface Reading {
  readonly dialect: ProjectionDialect;
  readonly projections: readonly KeptProjection[];
  readonly query: ReadQuery;
}

function orderedColumnsOf(projection: KeptProjection, orderBy: readonly string[]): readonly string[] {
  const [, ...keys] = keyColumnsOf(projection);
  return [...orderBy.map((column) => columnOf(projection, column)), ...keys];
}

function afterOf(dialect: ProjectionDialect, projection: KeptProjection, query: ProjectedRowsQuery): SQL {
  const { after, orderBy, order } = query;
  if (after === undefined) {
    return SQL.EMPTY;
  }
  const columns = orderedColumnsOf(projection, orderBy).join(', ');
  const values = SQL.merge(
    after.map((value: ProjectedValue) => SQL`${boundOf(dialect, value)}`),
    ', ',
  );
  return SQL` AND (${SQL.plain(columns)}) ${SQL.plain(order === 'asc' ? '>' : '<')} (${values})`;
}

function orderOf(projection: KeptProjection, { orderBy, order }: ProjectedRowsQuery): SQL {
  const direction = order === 'asc' ? 'ASC NULLS FIRST' : 'DESC NULLS LAST';
  const ordered = orderedColumnsOf(projection, orderBy)
    .map((column) => `${column} ${direction}`)
    .join(', ');
  return SQL`${SQL.plain(ordered)}`;
}

function keyedRowOf(
  projection: KeptProjection,
  stored: Readonly<Record<string, unknown>>,
): Option.Option<ProjectedKeyedRow> {
  const { playbook_key: prefix, row_key: key, child_key: child } = decodeKey(stored);
  return Option.map(addressOfStreamPrefix(prefix), (address) => ({
    ...address,
    key,
    ...(child === undefined ? {} : { child }),
    row: rowFrom(projection, stored),
  }));
}

function projectionNamed(projections: readonly KeptProjection[], name: string): KeptProjection | undefined {
  return projections.find((projection) => projection.name === name);
}

function keysSelected(projection: KeptProjection): SQL {
  return SQL`${SQL.plain(keepsChildRows(projection) ? `playbook_key, row_key, ${childKeyColumn}` : 'playbook_key, row_key')}`;
}

async function rowsRead(
  { dialect, query }: Reading,
  projection: KeptProjection,
  filter: SQL,
  ordered: SQL,
): Promise<readonly ProjectedKeyedRow[]> {
  const rows = await query(
    SQL`SELECT ${keysSelected(projection)}, ${selectedColumns(dialect, projection)} FROM ${tableOf(projection)} WHERE ${filter} ORDER BY ${ordered}`,
  );
  return rowsFrom(rows).flatMap((stored) => Option.toArray(keyedRowOf(projection, stored)));
}

function rowsUnder(reading: Reading, projection: KeptProjection, prefix: string, query: ProjectedRowsQuery) {
  const { dialect } = reading;
  const filter = SQL`playbook_key = ${prefix}${conditionsOf(dialect, projection, query.where)}${afterOf(dialect, projection, query)}`;
  return rowsRead(reading, projection, filter, SQL`${orderOf(projection, query)} LIMIT ${query.limit}`);
}

function dueRows(reading: Reading, projection: KeptProjection, { column, through, limit }: DueRowsQuery) {
  const due = columnOf(projection, column);
  return rowsRead(
    reading,
    projection,
    SQL`${SQL.plain(due)} IS NOT NULL AND ${SQL.plain(due)} <= ${through}`,
    SQL`${SQL.plain(due)}, playbook_key, row_key LIMIT ${limit}`,
  );
}

async function counted(
  reading: Reading,
  projection: KeptProjection,
  prefix: string,
  where: readonly ProjectedCondition[],
) {
  const rows = await reading.query(
    SQL`SELECT CAST(count(*) AS INTEGER) AS count FROM ${tableOf(projection)} WHERE playbook_key = ${prefix}${conditionsOf(reading.dialect, projection, where)}`,
  );
  return Schema.decodeUnknownSync(CountRows)(rows).reduce((total, { count }) => total + count, 0);
}

async function soonest(
  reading: Reading,
  projection: KeptProjection,
  column: string,
  after: number,
): Promise<number | null> {
  const named = columnOf(projection, column);
  const rows = await reading.query(
    SQL`SELECT ${SQL.plain(reading.dialect.asNumber(`min(${named})`))} AS due FROM ${tableOf(projection)} WHERE ${SQL.plain(named)} IS NOT NULL AND ${SQL.plain(named)} > ${after}`,
  );
  const [{ due }] = Schema.decodeUnknownSync(DueRows)(rows);
  return due;
}

function freshThen<A>(
  freshening: StreamFreshening,
  { name, address }: { readonly name: string; readonly address: ProjectedAddress },
  read: Effect.Effect<A>,
): Effect.Effect<A> {
  return Effect.promise(() => freshening.fresh(name, address)).pipe(
    Effect.flatMap((kept) => keptLogged(kept)),
    Effect.andThen(read),
  );
}

export function projectionReader(
  dialect: ProjectionDialect,
  projections: readonly KeptProjection[],
  { query, command }: ProjectionStatements,
  freshening: StreamFreshening,
): ProjectionReader & ProjectionAdvancer {
  const reading = { dialect, projections, query };
  const withProjection = <A>(name: string, none: A, read: (projection: KeptProjection) => Promise<A>) =>
    Effect.promise(() => {
      const projection = projectionNamed(projections, name);
      return projection === undefined ? Promise.resolve(none) : read(projection);
    });
  return {
    readProjectedRows: (name, address, rowsQuery) =>
      freshThen(
        freshening,
        { name, address },
        withProjection(name, [], (projection) =>
          rowsUnder(reading, projection, streamPrefixOfAddress(address), rowsQuery),
        ),
      ),
    countProjectedRows: (name, address, where) =>
      freshThen(
        freshening,
        { name, address },
        withProjection(name, 0, (projection) => counted(reading, projection, streamPrefixOfAddress(address), where)),
      ),
    resetStreamProjection: (name, address) =>
      Effect.promise(() => freshening.reset(name, address)).pipe(Effect.flatMap((kept) => keptLogged(kept))),
    readDueRows: (name, dueQuery) => withProjection(name, [], (projection) => dueRows(reading, projection, dueQuery)),
    nextDueOf: (name, column, after) =>
      withProjection(name, null, (projection) => soonest(reading, projection, column, after)),
    advanceRow: (name, address, key, advance) =>
      Effect.promise(async () => {
        const projection = projectionNamed(projections, name);
        if (projection !== undefined) {
          requireAdvancedColumns(projection, advance.set);
          await command(rowAdvance(dialect, projection, { prefix: streamPrefixOfAddress(address), key }, advance));
        }
      }),
  };
}
