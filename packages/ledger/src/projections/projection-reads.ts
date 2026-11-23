import { AsyncLocalStorage } from 'node:async_hooks';

import { SQL } from '@event-driven-io/dumbo';
import {
  addressOfStreamPrefix,
  childKeyColumn,
  playbookOfStreamPrefix,
  keepsChildRows,
  projectedTableOf,
  requireAdvancedColumns,
  streamPrefixOfAddress,
  streamPrefixOfTheDefinitionsOf,
  type DueRowsQuery,
  type KeptProjection,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type ProjectedRowsQuery,
  type ProjectedValue,
  type ProjectionAdvancer,
  type ProjectionReader,
  type RowsAddress,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { definitionNames } from '../definition-names/definition-names-table.ts';
import type { InTransaction } from '../event-store.ts';
import { servedOnceCaughtUp, type TablesCatchingUp } from '../projection-catch-up/catching-up.ts';
import { readNamed } from '../store-reads/store-reads.ts';
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

export type ConsistentReads = <A>(reads: (query: ReadQuery) => Promise<A>) => Promise<A>;

export function readsAsTheyCome(query: ReadQuery): ConsistentReads {
  return (reads) => reads(query);
}

export interface ProjectionStatements {
  readonly query: ReadQuery;
  readonly command: WriteCommand;
  readonly inTransaction: InTransaction;
  readonly consistently: ConsistentReads;
}

const KeyFields = Schema.Struct({
  playbook_key: Schema.String,
  row_key: Schema.String,
  child_key: Schema.optionalKey(Schema.String),
  placed_in: Schema.optionalKey(Schema.NullOr(Schema.String)),
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
  const { playbook_key: prefix, row_key: key, child_key: child, placed_in: placedIn } = decodeKey(stored);
  const placed = Option.getOrUndefined(playbookOfStreamPrefix(placedIn ?? ''));
  return Option.map(addressOfStreamPrefix(prefix), (address) => ({
    ...address,
    ...(placed === undefined ? {} : { playbook: placed.playbook }),
    key,
    ...(child === undefined ? {} : { child }),
    row: rowFrom(projection, stored),
  }));
}

const playbookOfTheRow = SQL`(SELECT n.playbook_key FROM ${definitionNames} AS n WHERE n.definition_key = t.playbook_key) AS placed_in`;

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
    SQL`SELECT ${keysSelected(projection)}, ${selectedColumns(dialect, projection)}, ${playbookOfTheRow} FROM ${tableOf(projection)} AS t WHERE ${filter} ORDER BY ${ordered}`,
  );
  return rowsFrom(rows).flatMap((stored) => Option.toArray(keyedRowOf(projection, stored)));
}

function placedUnder(prefix: string): SQL {
  return SQL`(playbook_key = ${prefix} OR playbook_key IN (SELECT definition_key FROM ${definitionNames} WHERE playbook_key = ${prefix}))`;
}

function placedInThePlaybooksOf(org: string): SQL {
  const definitions = streamPrefixOfTheDefinitionsOf({ org });
  return SQL`playbook_key IN (SELECT definition_key FROM ${definitionNames} WHERE substr(definition_key, 1, ${Array.from(definitions).length}) = ${definitions})`;
}

function placedAt(address: RowsAddress): SQL {
  return address.definitions === 'every'
    ? placedInThePlaybooksOf(address.org)
    : placedUnder(streamPrefixOfAddress(address));
}

function rowsUnder(reading: Reading, projection: KeptProjection, address: RowsAddress, query: ProjectedRowsQuery) {
  const { dialect } = reading;
  const filter = SQL`${placedAt(address)}${conditionsOf(dialect, projection, query.where)}${afterOf(dialect, projection, query)}`;
  return rowsRead(reading, projection, filter, SQL`${orderOf(projection, query)} LIMIT ${query.limit}`);
}

function rowsOfKeys(reading: Reading, projection: KeptProjection, address: RowsAddress, keys: readonly string[]) {
  if (keepsChildRows(projection)) {
    throw new Error(`A read by keys reads a keyed projection, and ${projection.name} keeps child rows`);
  }
  const filter = SQL`${placedAt(address)} AND ${reading.dialect.oneOf('row_key', keys)}`;
  return rowsRead(reading, projection, filter, SQL`row_key`);
}

function inTheOrderAsked(
  keys: readonly string[],
  rows: readonly ProjectedKeyedRow[],
): readonly (ProjectedKeyedRow | undefined)[] {
  const byKey = new Map(rows.map((kept) => [kept.key, kept]));
  return keys.map((key) => byKey.get(key));
}

function noSoonerInItsPlaybook(projection: KeptProjection, due: string, through: number): SQL {
  const ordered = [due, ...keyColumnsOf(projection).slice(1)];
  const of = (table: string) => ordered.map((column) => `${table}.${column}`).join(', ');
  return SQL` AND NOT EXISTS (SELECT 1 FROM ${tableOf(projection)} AS s WHERE s.playbook_key = t.playbook_key AND s.${SQL.plain(due)} IS NOT NULL AND s.${SQL.plain(due)} <= ${through} AND (${SQL.plain(of('s'))}) < (${SQL.plain(of('t'))}))`;
}

function dueRows(reading: Reading, projection: KeptProjection, query: DueRowsQuery) {
  const { column, through, limit, onePerPlaybook = false } = query;
  const due = columnOf(projection, column);
  const firstOfEach = onePerPlaybook ? noSoonerInItsPlaybook(projection, due, through) : SQL.EMPTY;
  return rowsRead(
    reading,
    projection,
    SQL`${SQL.plain(due)} IS NOT NULL AND ${SQL.plain(due)} <= ${through}${firstOfEach}`,
    SQL`${SQL.plain(due)}, playbook_key, row_key LIMIT ${limit}`,
  );
}

async function counted(
  reading: Reading,
  projection: KeptProjection,
  address: RowsAddress,
  where: readonly ProjectedCondition[],
) {
  const rows = await reading.query(
    SQL`SELECT CAST(count(*) AS INTEGER) AS count FROM ${tableOf(projection)} WHERE ${placedAt(address)}${conditionsOf(reading.dialect, projection, where)}`,
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

const consistentQuery = new AsyncLocalStorage<ReadQuery>();

function readTogetherOn(consistently: ConsistentReads): ProjectionReader['readTogether'] {
  return <A, E, R>(reads: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(Effect.context<R>(), (context) =>
      Effect.suspend(() =>
        consistentQuery.getStore() === undefined
          ? Effect.flatten(
              Effect.promise(() =>
                consistently((query) => consistentQuery.run(query, () => Effect.runPromiseExitWith(context)(reads))),
              ),
            )
          : reads,
      ),
    );
}

export function projectionReader(
  dialect: ProjectionDialect,
  projections: readonly KeptProjection[],
  { query: plainQuery, command, consistently }: ProjectionStatements,
  catchingUp: TablesCatchingUp,
): ProjectionReader & ProjectionAdvancer {
  const query: ReadQuery = (sql) => (consistentQuery.getStore() ?? plainQuery)(sql);
  const reading = { dialect, projections, query };
  const served = servedOnceCaughtUp(catchingUp, query);
  const withProjection = <A>(name: string, none: A, read: (projection: KeptProjection) => Promise<A>) =>
    Effect.suspend(() => {
      const projection = projectionNamed(projections, name);
      return projection === undefined
        ? Effect.succeed(none)
        : Effect.andThen(
            served(projection),
            Effect.promise(() => readNamed(projectedTableOf(projection), () => read(projection))),
          );
    });
  return {
    readProjectedRows: (name, address, rowsQuery) =>
      withProjection(name, [], (projection) => rowsUnder(reading, projection, address, rowsQuery)),
    countProjectedRows: (name, address, where) =>
      withProjection(name, 0, (projection) => counted(reading, projection, address, where)),
    readProjectedRowsOfKeys: (name, address, keys) =>
      keys.length === 0
        ? Effect.succeed([])
        : withProjection(name, inTheOrderAsked(keys, []), async (projection) =>
            inTheOrderAsked(keys, await rowsOfKeys(reading, projection, address, keys)),
          ),
    readTogether: readTogetherOn(consistently),
    readDueRows: (name, dueQuery) => withProjection(name, [], (projection) => dueRows(reading, projection, dueQuery)),
    nextDueOf: (name, column, after) =>
      withProjection(name, null, (projection) => soonest(reading, projection, column, after)),
    advanceRow: (name, address, key, advance) =>
      withProjection<void>(name, undefined, async (projection) => {
        requireAdvancedColumns(projection, advance.set);
        await command(rowAdvance(dialect, projection, { prefix: streamPrefixOfAddress(address), key }, advance));
      }),
  };
}
