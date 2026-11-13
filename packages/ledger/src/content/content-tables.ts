import { SQL } from '@event-driven-io/dumbo';
import type { KeptContentHead } from '@on.auto/content';
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

export const keptInTheLedger = 'ledger';

export const keptExternally = 'external';

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
      kept_at BIGINT NOT NULL DEFAULT 0,
      kept_in TEXT NOT NULL DEFAULT 'ledger',
      removing_since BIGINT,
      expires_at BIGINT,
      erased_at BIGINT,
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

function expiringIndexOf({ heads }: Shelf): PlaybookIndex {
  const name = `${heads}_expiring`;
  return {
    name,
    create: () =>
      SQL`CREATE INDEX IF NOT EXISTS ${SQL.identifier(name)} ON ${SQL.identifier(heads)} (expires_at) WHERE expires_at IS NOT NULL`,
  };
}

const contentIndexes: readonly PlaybookIndex[] = shelves.flatMap((shelf) => [
  uploadIndexOf(shelf),
  expiringIndexOf(shelf),
]);

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

export function expiryOfThePut(expiresAt: number | undefined): SQL {
  return SQL`CAST(${expiresAt ?? null} AS BIGINT)`;
}

export function laterExpiry(standing: SQL, put: SQL): SQL {
  return SQL`CASE WHEN ${standing} IS NULL OR ${put} IS NULL THEN NULL WHEN ${standing} < ${put} THEN ${put} ELSE ${standing} END`;
}

export function expiryKept(standing: SQL, expiresAt: number | undefined): SQL {
  return expiresAt === undefined ? SQL`NULL` : laterExpiry(standing, expiryOfThePut(expiresAt));
}

export function expiryKeptOver(table: string): SQL {
  const heads = SQL.identifier(table);
  const put = SQL`excluded.expires_at`;
  return SQL`CASE WHEN ${heads}.erased_at IS NOT NULL THEN ${put} ELSE ${laterExpiry(SQL`${heads}.expires_at`, put)} END`;
}

export function dueBy(now: number): SQL {
  return SQL`expires_at IS NOT NULL AND expires_at <= ${now}`;
}

export const keptHeadColumns = SQL.plain(
  'CAST(bytes AS DOUBLE PRECISION) AS bytes, media_type, CAST(kept_at AS DOUBLE PRECISION) AS kept_at, CAST(expires_at AS DOUBLE PRECISION) AS expires_at, CAST(erased_at AS DOUBLE PRECISION) AS erased_at',
);

const KeptHeadRows = Schema.Array(
  Schema.Struct({
    bytes: Schema.Number,
    media_type: Schema.String,
    kept_at: Schema.Number,
    expires_at: Schema.NullOr(Schema.Number),
    erased_at: Schema.NullOr(Schema.Number),
  }),
);

function keptHeadOf({ bytes, media_type, kept_at, expires_at, erased_at }: (typeof KeptHeadRows.Type)[number]) {
  const kept: KeptContentHead = { bytes, mediaType: media_type, keptAt: kept_at };
  const expiring = expires_at === null ? kept : { ...kept, expiresAt: expires_at };
  return erased_at === null ? expiring : { ...expiring, erasedAt: erased_at };
}

export function keptHeadIn(rows: readonly unknown[]): KeptContentHead | undefined {
  const row = Schema.decodeUnknownSync(KeptHeadRows)(rows).at(0);
  return row === undefined ? undefined : keptHeadOf(row);
}
