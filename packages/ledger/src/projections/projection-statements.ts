import { SQL } from '@event-driven-io/dumbo';
import {
  childKeyColumn,
  comparedColumnOf,
  keepsChildRows,
  projectedTableOf,
  type KeptProjection,
  type ProjectedComparison,
  type ProjectedCondition,
  type ProjectedIndex,
  type ProjectedRow,
  type ProjectedValue,
  type ProjectionDeclaration,
  type RowAdvance,
} from '@on.auto/operations';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from './inline-projection.ts';
import { boundOf, selectedColumn, valueOf, type ProjectionDialect } from './projection-dialect.ts';

export interface RowPlace {
  readonly prefix: string;
  readonly key: string;
}

export interface KeptRow extends RowPlace {
  readonly row: ProjectedRow;
}

const keyColumns = ['playbook_key', 'row_key'] as const;

export const childKeyColumns = [...keyColumns, childKeyColumn] as const;

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

const OrderedMessageRows = Schema.Array(
  Schema.Struct({ point: Schema.String, ordered: Schema.String, ...MessageFields }),
);

const decodeObjects = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)));

export function tableOf(projection: Pick<ProjectionDeclaration, 'name' | 'version'>): SQL {
  return SQL`${SQL.plain(projectedTableOf(projection))}`;
}

function indexedColumnsOf(dialect: ProjectionDialect, index: ProjectedIndex): readonly string[] {
  return index.acrossPlaybooks === true
    ? index.columns
    : ['playbook_key', ...index.columns].map((column) => `${column}${dialect.playbookIndexNulls}`);
}

function indexStatement(dialect: ProjectionDialect, projection: ProjectionDeclaration, index: ProjectedIndex): SQL {
  const table = projectedTableOf(projection);
  const columns = indexedColumnsOf(dialect, index).join(', ');
  const where = index.whereSet === undefined ? '' : ` WHERE ${index.whereSet} IS NOT NULL`;
  return SQL`CREATE INDEX IF NOT EXISTS ${SQL.plain(`${table}_${index.name}`)} ON ${tableOf(projection)} (${SQL.plain(columns)})${SQL.plain(where)}`;
}

export function keyColumnsOf(projection: KeptProjection): readonly string[] {
  return keepsChildRows(projection) ? childKeyColumns : keyColumns;
}

export function createdTable(dialect: ProjectionDialect, projection: KeptProjection): readonly SQL[] {
  const key = `${dialect.columnTypes.text} NOT NULL`;
  const columns = [
    ...keyColumnsOf(projection).map((name) => `${name} ${key}`),
    ...projection.columns.map(({ name, kind }) => `${name} ${dialect.columnTypes[kind]}`),
  ].join(',\n      ');
  return [
    SQL`CREATE TABLE IF NOT EXISTS ${tableOf(projection)} (
      ${SQL.plain(columns)},
      PRIMARY KEY (${SQL.plain(keyColumnsOf(projection).join(', '))})
    )`,
    ...projection.indexes.map((index) => indexStatement(dialect, projection, index)),
  ];
}

export function selectedColumns(dialect: ProjectionDialect, projection: ProjectionDeclaration): SQL {
  return SQL`${SQL.plain(projection.columns.map((column) => selectedColumn(dialect, column)).join(', '))}`;
}

export function rowFrom(projection: ProjectionDeclaration, stored: Readonly<Record<string, unknown>>): ProjectedRow {
  return Object.fromEntries(projection.columns.map((column) => [column.name, valueOf(column, stored[column.name])]));
}

export function rowsFrom(rows: readonly unknown[]): readonly Readonly<Record<string, unknown>>[] {
  return decodeObjects(rows);
}

export async function rowIn(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  projection: ProjectionDeclaration,
  { prefix, key }: RowPlace,
): Promise<ProjectedRow | undefined> {
  const { rows } = await execute.query(
    SQL`SELECT ${selectedColumns(dialect, projection)} FROM ${tableOf(projection)} WHERE playbook_key = ${prefix} AND row_key = ${key}`,
  );
  const [stored] = rowsFrom(rows);
  return stored === undefined ? undefined : rowFrom(projection, stored);
}

export function valuesOf(
  dialect: ProjectionDialect,
  projection: Pick<ProjectionDeclaration, 'columns'>,
  { prefix, key, row }: KeptRow,
): SQL {
  const values = projection.columns.map(({ name }) => SQL`${boundOf(dialect, row[name] ?? null)}`);
  return SQL`(${SQL.merge([SQL`${prefix}`, SQL`${key}`, ...values], ', ')})`;
}

function updatedColumns(projection: ProjectionDeclaration, standing: readonly string[]): readonly string[] {
  return projection.columns.map(({ name }) => name).filter((name) => !standing.includes(name));
}

export function rowsWrite(
  dialect: ProjectionDialect,
  projection: ProjectionDeclaration,
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

export function columnOf(projection: KeptProjection, name: string): string {
  if (!keyColumnsOf(projection).includes(name) && !projection.columns.some((column) => column.name === name)) {
    throw new Error(`The projection ${projection.name} has no column ${name}`);
  }
  return name;
}

const operators: Readonly<Record<ProjectedComparison, string>> = { equals: '=', after: '>', before: '<' };

export function conditionsOf(
  dialect: ProjectionDialect,
  projection: KeptProjection,
  where: readonly ProjectedCondition[],
) {
  return SQL.merge(
    where.map((condition) => {
      const { column, comparison, value } = comparedColumnOf(projection, condition);
      return SQL` AND ${SQL.plain(column)} ${SQL.plain(operators[comparison])} ${boundOf(dialect, value)}`;
    }),
    '',
  );
}

export function rowAdvance(
  dialect: ProjectionDialect,
  projection: KeptProjection,
  { prefix, key }: RowPlace,
  { set, when }: RowAdvance,
): SQL {
  const assignments = SQL.merge(
    Object.entries(set).map(
      ([name, value]: readonly [string, ProjectedValue]) => SQL`${SQL.plain(name)} = ${boundOf(dialect, value)}`,
    ),
    ', ',
  );
  return SQL`UPDATE ${tableOf(projection)} SET ${assignments} WHERE playbook_key = ${prefix} AND row_key = ${key}${conditionsOf(dialect, projection, when)}`;
}

type NamedPlace = readonly [string, RowPlace];

function inLockOrder(places: readonly RowPlace[]): readonly RowPlace[] {
  const named = new Map(places.map((place): NamedPlace => [`${place.prefix}${place.key}`, place]));
  return [...named]
    .toSorted(([left]: NamedPlace, [right]: NamedPlace) => Number(left > right) - Number(left < right))
    .map(([, place]: NamedPlace) => place);
}

export async function rowsLocked(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  projection: ProjectionDeclaration,
  places: readonly RowPlace[],
): Promise<void> {
  const table = projectedTableOf(projection);
  const locks = inLockOrder(places).flatMap(({ prefix, key }) => dialect.rowLocks(table, prefix, key));
  await inTurn(locks, (lock) => execute.query(lock));
}

export function rowDelete(projection: ProjectionDeclaration, { prefix, key }: RowPlace): SQL {
  return SQL`DELETE FROM ${tableOf(projection)} WHERE playbook_key = ${prefix} AND row_key = ${key}`;
}

export function tableDrop(name: string): SQL {
  return SQL`DROP TABLE IF EXISTS ${SQL.plain(name)}`;
}

export function tableAnalysis(projection: ProjectionDeclaration): SQL {
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

const SizedPointRows = Schema.Array(Schema.Struct({ point: Schema.String, size: Schema.Number }));

export type SizedPoint = (typeof SizedPointRows.Type)[number];

export async function sizedPointsIn(execute: StatementExecutor, query: SQL): Promise<readonly SizedPoint[]> {
  const { rows } = await execute.query(query);
  return Schema.decodeUnknownSync(SizedPointRows)(rows);
}
