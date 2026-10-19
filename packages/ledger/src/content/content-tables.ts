import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { createMissingIndexes, type PlaybookIndex } from '../recorded/missing-indexes.ts';
import type { ContentDialect } from './content-dialects.ts';

export interface Shelf {
  readonly chunks: string;
  readonly heads: string;
  readonly placeColumns: readonly string[];
  readonly chunkMissing: (sha256: string, index: number) => Error;
}

export const keptShelf: Shelf = {
  chunks: 'recorded_content_chunks',
  heads: 'recorded_content_heads',
  placeColumns: ['playbook_key'],
  chunkMissing: (sha256, index) => new Error(`The content kept under ${sha256} is missing its chunk ${index}`),
};

export const stagingShelf: Shelf = {
  chunks: 'staged_content_chunks',
  heads: 'staged_content',
  placeColumns: ['playbook_key', 'run_id'],
  chunkMissing: (sha256, index) =>
    new Error(`The content staged under ${sha256} has no chunk ${index}, as when its run is unstaged while it is read`),
};

export const unstagedRuns = 'unstaged_runs';

export interface ContentTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly create: (dialect: ContentDialect) => SQL;
}

function textColumns(columns: readonly string[]): SQL {
  return SQL.merge(
    columns.map((column) => SQL`${SQL.identifier(column)} TEXT NOT NULL`),
    ', ',
  );
}

function namesOf(columns: readonly string[]): SQL {
  return SQL.merge(
    columns.map((column) => SQL`${SQL.identifier(column)}`),
    ', ',
  );
}

function chunkTableOf({ chunks, placeColumns }: Shelf): ContentTable {
  const key = [...placeColumns, 'upload_id', 'chunk'];
  return {
    name: chunks,
    columns: [...key, 'data'],
    create: ({ bytesType }) => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(chunks)} (
      ${textColumns([...placeColumns, 'upload_id'])},
      chunk INTEGER NOT NULL,
      data ${SQL.plain(bytesType)} NOT NULL,
      PRIMARY KEY (${namesOf(key)})
    )`,
  };
}

function headTableOf({ heads, placeColumns }: Shelf): ContentTable {
  const key = [...placeColumns, 'sha256'];
  return {
    name: heads,
    columns: [...key, 'upload_id', 'bytes', 'chunks', 'media_type'],
    create: () => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(heads)} (
      ${textColumns([...key, 'upload_id'])},
      bytes BIGINT NOT NULL,
      chunks INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      PRIMARY KEY (${namesOf(key)})
    )`,
  };
}

const unstagedRunsTable: ContentTable = {
  name: unstagedRuns,
  columns: stagingShelf.placeColumns,
  create: () => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(unstagedRuns)} (
    ${textColumns(stagingShelf.placeColumns)},
    PRIMARY KEY (${namesOf(stagingShelf.placeColumns)})
  )`,
};

export const shelves: readonly Shelf[] = [keptShelf, stagingShelf];

export const contentTables: readonly ContentTable[] = [
  ...shelves.flatMap((shelf) => [chunkTableOf(shelf), headTableOf(shelf)]),
  unstagedRunsTable,
];

export const contentTableNames: readonly string[] = contentTables.map(({ name }) => name);

function uploadIndexOf({ heads, placeColumns }: Shelf): PlaybookIndex {
  const name = `${heads}_by_upload`;
  return {
    name,
    create: () =>
      SQL`CREATE INDEX IF NOT EXISTS ${SQL.identifier(name)} ON ${SQL.identifier(heads)} (${namesOf([...placeColumns, 'upload_id'])})`,
  };
}

const contentIndexes: readonly PlaybookIndex[] = shelves.map((shelf) => uploadIndexOf(shelf));

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

export async function namesFound(execute: StatementExecutor, sql: SQL): Promise<readonly string[]> {
  const { rows } = await execute.query(sql);
  return Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name);
}

function listed(columns: readonly string[]): string {
  return columns.toSorted().join(', ');
}

export interface KeptTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly holds: string;
}

export async function requireTheShapeKept(
  execute: StatementExecutor,
  dialect: ContentDialect,
  { name, columns, holds }: KeptTable,
): Promise<void> {
  const found = await namesFound(execute, dialect.columnsOf(name));
  if (listed(found) !== listed(columns)) {
    throw new Error(
      `The ledger's database keeps ${holds} in a shape this server no longer reads: ${name} has the columns ${listed(found)}, where this server keeps ${listed(columns)}. Nothing stored before launch is carried over, so delete the local database and start the server again`,
    );
  }
}

export async function createdContentTables(execute: StatementExecutor, dialect: ContentDialect): Promise<void> {
  const existing = new Set(await namesFound(execute, dialect.relationsAmong('table', contentTableNames)));
  await inTurn(
    contentTables.filter(({ name }) => existing.has(name)),
    (table) => requireTheShapeKept(execute, dialect, { ...table, holds: 'recorded content' }),
  );
  await createMissingIndexes(
    execute,
    contentTables.map((table) => ({ name: table.name, create: () => table.create(dialect) })),
    existing,
  );
  const indexed = new Set(
    await namesFound(
      execute,
      dialect.relationsAmong(
        'index',
        contentIndexes.map(({ name }) => name),
      ),
    ),
  );
  await createMissingIndexes(execute, contentIndexes, indexed);
}
