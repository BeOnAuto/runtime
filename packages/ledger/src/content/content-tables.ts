import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
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

interface ContentTable {
  readonly name: string;
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
    create: () => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(heads)} (
      ${textColumns([...key, 'upload_id'])},
      bytes BIGINT NOT NULL,
      chunks INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      PRIMARY KEY (${namesOf(key)})
    )`,
  };
}

export const shelves: readonly Shelf[] = [keptShelf];

const contentTables: readonly ContentTable[] = shelves.flatMap((shelf) => [chunkTableOf(shelf), headTableOf(shelf)]);

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

export async function createdContentTables(execute: StatementExecutor, dialect: ContentDialect): Promise<void> {
  const existing = new Set(await namesFound(execute, dialect.relationsAmong('table', contentTableNames)));
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
