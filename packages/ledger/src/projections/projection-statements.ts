import { SQL } from '@event-driven-io/dumbo';
import {
  projectedTableOf,
  rowKeyColumn,
  type KeyedProjection,
  type ProjectedCondition,
  type ProjectedIndex,
  type ProjectedRow,
  type ProjectedValue,
  type RowAdvance,
} from '@on.auto/operations';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { boundOf, selectedColumn, valueOf, type ProjectionDialect } from './projection-dialect.ts';

export interface RowPlace {
  readonly playbookKey: string;
  readonly key: string;
}

export interface KeptRow extends RowPlace {
  readonly row: ProjectedRow;
}

const keyColumns = ['playbook_key', 'row_key'] as const;

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

const StreamRows = Schema.Array(Schema.Struct({ stream: Schema.String, size: Schema.Number }));

const MessageFields = {
  stream: Schema.String,
  type: Schema.String,
  data: Schema.Unknown,
  metadata: Schema.Unknown,
  position: Schema.Number,
};

const MessageRows = Schema.Array(Schema.Struct(MessageFields));

const OrderedMessageRows = Schema.Array(Schema.Struct({ point: Schema.String, ...MessageFields }));

const decodeObjects = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)));

export function tableOf(projection: KeyedProjection): SQL {
  return SQL`${SQL.plain(projectedTableOf(projection))}`;
}

function indexedColumnsOf(dialect: ProjectionDialect, index: ProjectedIndex): readonly string[] {
  return index.acrossPlaybooks === true
    ? index.columns
    : ['playbook_key', ...index.columns].map((column) => `${column}${dialect.playbookIndexNulls}`);
}

function indexStatement(dialect: ProjectionDialect, projection: KeyedProjection, index: ProjectedIndex): SQL {
  const table = projectedTableOf(projection);
  const columns = indexedColumnsOf(dialect, index).join(', ');
  const where = index.whereSet === undefined ? '' : ` WHERE ${index.whereSet} IS NOT NULL`;
  return SQL`CREATE INDEX IF NOT EXISTS ${SQL.plain(`${table}_${index.name}`)} ON ${tableOf(projection)} (${SQL.plain(columns)})${SQL.plain(where)}`;
}

export function createdTable(dialect: ProjectionDialect, projection: KeyedProjection): readonly SQL[] {
  const columns = projection.columns.map(({ name, kind }) => `${name} ${dialect.columnTypes[kind]}`).join(',\n      ');
  const key = `${dialect.columnTypes.text} NOT NULL`;
  return [
    SQL`CREATE TABLE IF NOT EXISTS ${tableOf(projection)} (
      playbook_key ${SQL.plain(key)},
      row_key ${SQL.plain(key)},
      ${SQL.plain(columns)},
      PRIMARY KEY (playbook_key, row_key)
    )`,
    ...projection.indexes.map((index) => indexStatement(dialect, projection, index)),
  ];
}

export function selectedColumns(dialect: ProjectionDialect, projection: KeyedProjection): SQL {
  return SQL`${SQL.plain(projection.columns.map((column) => selectedColumn(dialect, column)).join(', '))}`;
}

export function rowFrom(projection: KeyedProjection, stored: Readonly<Record<string, unknown>>): ProjectedRow {
  return Object.fromEntries(projection.columns.map((column) => [column.name, valueOf(column, stored[column.name])]));
}

export function rowsFrom(rows: readonly unknown[]): readonly Readonly<Record<string, unknown>>[] {
  return decodeObjects(rows);
}

export async function rowIn(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  projection: KeyedProjection,
  { playbookKey, key }: RowPlace,
): Promise<ProjectedRow | undefined> {
  const { rows } = await execute.query(
    SQL`SELECT ${selectedColumns(dialect, projection)} FROM ${tableOf(projection)} WHERE playbook_key = ${playbookKey} AND row_key = ${key}`,
  );
  const [stored] = rowsFrom(rows);
  return stored === undefined ? undefined : rowFrom(projection, stored);
}

function valuesOf(dialect: ProjectionDialect, projection: KeyedProjection, { playbookKey, key, row }: KeptRow): SQL {
  const values = projection.columns.map(({ name }) => SQL`${boundOf(dialect, row[name] ?? null)}`);
  return SQL`(${SQL.merge([SQL`${playbookKey}`, SQL`${key}`, ...values], ', ')})`;
}

function updatedColumns(projection: KeyedProjection, standing: readonly string[]): readonly string[] {
  return projection.columns.map(({ name }) => name).filter((name) => !standing.includes(name));
}

export function rowsWrite(
  dialect: ProjectionDialect,
  projection: KeyedProjection,
  kept: readonly KeptRow[],
  standing: readonly string[] = [],
): SQL {
  const names = projection.columns.map(({ name }) => name);
  const columns = SQL.plain([...keyColumns, ...names].join(', '));
  const updates = SQL.plain(
    updatedColumns(projection, standing)
      .map((name) => `${name} = excluded.${name}`)
      .join(', '),
  );
  const values = SQL.merge(
    kept.map((each) => valuesOf(dialect, projection, each)),
    ', ',
  );
  return SQL`INSERT INTO ${tableOf(projection)} (${columns})
    VALUES ${values}
    ON CONFLICT (playbook_key, row_key) DO UPDATE SET ${updates}`;
}

export function columnOf(projection: KeyedProjection, name: string): string {
  if (name !== rowKeyColumn && !projection.columns.some((column) => column.name === name)) {
    throw new Error(`The projection ${projection.name} has no column ${name}`);
  }
  return name;
}

export function conditionsOf(
  dialect: ProjectionDialect,
  projection: KeyedProjection,
  where: readonly ProjectedCondition[],
) {
  return SQL.merge(
    where.map(
      ({ column, equals }) => SQL` AND ${SQL.plain(columnOf(projection, column))} = ${boundOf(dialect, equals)}`,
    ),
    '',
  );
}

export function rowAdvance(
  dialect: ProjectionDialect,
  projection: KeyedProjection,
  { playbookKey, key }: RowPlace,
  { set, when }: RowAdvance,
): SQL {
  const assignments = SQL.merge(
    Object.entries(set).map(
      ([name, value]: readonly [string, ProjectedValue]) => SQL`${SQL.plain(name)} = ${boundOf(dialect, value)}`,
    ),
    ', ',
  );
  return SQL`UPDATE ${tableOf(projection)} SET ${assignments} WHERE playbook_key = ${playbookKey} AND row_key = ${key}${conditionsOf(dialect, projection, when)}`;
}

export function tableDrop(name: string): SQL {
  return SQL`DROP TABLE IF EXISTS ${SQL.plain(name)}`;
}

export function tableAnalysis(projection: KeyedProjection): SQL {
  return SQL`ANALYZE ${tableOf(projection)}`;
}

export async function namesIn(execute: StatementExecutor, query: SQL): Promise<readonly string[]> {
  const { rows } = await execute.query(query);
  return Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name);
}

export interface SizedStream {
  readonly stream: string;
  readonly size: number;
}

export async function streamsIn(execute: StatementExecutor, query: SQL): Promise<readonly SizedStream[]> {
  const { rows } = await execute.query(query);
  return Schema.decodeUnknownSync(StreamRows)(rows);
}

export async function messagesIn(execute: StatementExecutor, query: SQL) {
  const { rows } = await execute.query(query);
  return Schema.decodeUnknownSync(MessageRows)(rows);
}

export async function orderedMessagesIn(execute: StatementExecutor, query: SQL) {
  const { rows } = await execute.query(query);
  return Schema.decodeUnknownSync(OrderedMessageRows)(rows);
}
