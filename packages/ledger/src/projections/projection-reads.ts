import { SQL } from '@event-driven-io/dumbo';
import {
  playbookOfStreamPrefix,
  requireAdvancedColumns,
  rowKeyColumn,
  streamPrefixOfPlaybook,
  type DueRowsQuery,
  type KeyedProjection,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type ProjectedRowsQuery,
  type ProjectedValue,
  type ProjectionAdvancer,
  type ProjectionReader,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { boundOf, type ProjectionDialect } from './projection-dialect.ts';
import {
  columnOf,
  conditionsOf,
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
}

const KeyFields = Schema.Struct({ playbook_key: Schema.String, row_key: Schema.String });

const decodeKey = Schema.decodeUnknownSync(KeyFields);

const CountRows = Schema.Array(Schema.Struct({ count: Schema.Number }));

const DueRows = Schema.Tuple([Schema.Struct({ due: Schema.NullOr(Schema.Number) })]);

interface Reading {
  readonly dialect: ProjectionDialect;
  readonly projections: readonly KeyedProjection[];
  readonly query: ReadQuery;
}

function afterOf(dialect: ProjectionDialect, projection: KeyedProjection, query: ProjectedRowsQuery): SQL {
  const { after, orderBy, order } = query;
  if (after === undefined) {
    return SQL.EMPTY;
  }
  const columns = [...orderBy.map((column) => columnOf(projection, column)), rowKeyColumn].join(', ');
  const values = SQL.merge(
    after.map((value: ProjectedValue) => SQL`${boundOf(dialect, value)}`),
    ', ',
  );
  return SQL` AND (${SQL.plain(columns)}) ${SQL.plain(order === 'asc' ? '>' : '<')} (${values})`;
}

function orderOf(projection: KeyedProjection, { orderBy, order }: ProjectedRowsQuery): SQL {
  const direction = order === 'asc' ? 'ASC NULLS FIRST' : 'DESC NULLS LAST';
  const ordered = [...orderBy.map((column) => columnOf(projection, column)), rowKeyColumn]
    .map((column) => `${column} ${direction}`)
    .join(', ');
  return SQL`${SQL.plain(ordered)}`;
}

function keyedRowOf(
  projection: KeyedProjection,
  stored: Readonly<Record<string, unknown>>,
): Option.Option<ProjectedKeyedRow> {
  const { playbook_key: prefix, row_key: key } = decodeKey(stored);
  return Option.map(playbookOfStreamPrefix(prefix), (playbook) => ({
    ...playbook,
    key,
    row: rowFrom(projection, stored),
  }));
}

function projectionNamed(projections: readonly KeyedProjection[], name: string): KeyedProjection | undefined {
  return projections.find((projection) => projection.name === name);
}

async function rowsRead(
  { dialect, query }: Reading,
  projection: KeyedProjection,
  filter: SQL,
  ordered: SQL,
): Promise<readonly ProjectedKeyedRow[]> {
  const rows = await query(
    SQL`SELECT playbook_key, row_key, ${selectedColumns(dialect, projection)} FROM ${tableOf(projection)} WHERE ${filter} ORDER BY ${ordered}`,
  );
  return rowsFrom(rows).flatMap((stored) => Option.toArray(keyedRowOf(projection, stored)));
}

function playbookRows(reading: Reading, projection: KeyedProjection, playbook: string, query: ProjectedRowsQuery) {
  const { dialect } = reading;
  const filter = SQL`playbook_key = ${playbook}${conditionsOf(dialect, projection, query.where)}${afterOf(dialect, projection, query)}`;
  return rowsRead(reading, projection, filter, SQL`${orderOf(projection, query)} LIMIT ${query.limit}`);
}

function dueRows(reading: Reading, projection: KeyedProjection, { column, through, limit }: DueRowsQuery) {
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
  projection: KeyedProjection,
  playbook: string,
  where: readonly ProjectedCondition[],
) {
  const rows = await reading.query(
    SQL`SELECT CAST(count(*) AS INTEGER) AS count FROM ${tableOf(projection)} WHERE playbook_key = ${playbook}${conditionsOf(reading.dialect, projection, where)}`,
  );
  return Schema.decodeUnknownSync(CountRows)(rows).reduce((total, { count }) => total + count, 0);
}

async function soonest(
  reading: Reading,
  projection: KeyedProjection,
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

export function projectionReader(
  dialect: ProjectionDialect,
  projections: readonly KeyedProjection[],
  { query, command }: ProjectionStatements,
): ProjectionReader & ProjectionAdvancer {
  const reading = { dialect, projections, query };
  const withProjection = <A>(name: string, none: A, read: (projection: KeyedProjection) => Promise<A>) =>
    Effect.promise(() => {
      const projection = projectionNamed(projections, name);
      return projection === undefined ? Promise.resolve(none) : read(projection);
    });
  return {
    readProjectedRows: (name, playbook, rowsQuery) =>
      withProjection(name, [], (projection) =>
        playbookRows(reading, projection, streamPrefixOfPlaybook(playbook), rowsQuery),
      ),
    countProjectedRows: (name, playbook, where) =>
      withProjection(name, 0, (projection) => counted(reading, projection, streamPrefixOfPlaybook(playbook), where)),
    readDueRows: (name, dueQuery) => withProjection(name, [], (projection) => dueRows(reading, projection, dueQuery)),
    nextDueOf: (name, column, after) =>
      withProjection(name, null, (projection) => soonest(reading, projection, column, after)),
    advanceRow: (name, playbook, key, advance) =>
      Effect.promise(async () => {
        const projection = projectionNamed(projections, name);
        if (projection !== undefined) {
          requireAdvancedColumns(projection, advance.set);
          await command(
            rowAdvance(dialect, projection, { playbookKey: streamPrefixOfPlaybook(playbook), key }, advance),
          );
        }
      }),
  };
}
