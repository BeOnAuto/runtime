import { SQL } from '@event-driven-io/dumbo';
import type { ContentOwner, KeptContentHead } from '@on.auto/content';
import { streamPrefixOfOrg } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { createMissingIndexes, type PlaybookIndex } from '../recorded/missing-indexes.ts';
import type { ContentDialect } from './content-dialects.ts';

export interface Shelf {
  readonly chunks: string;
  readonly heads: string;
  readonly places: string;
  readonly chunkMissing: (sha256: string, index: number) => Error;
}

export const keptInTheLedger = 'ledger';

export const keptExternally = 'external';

export const keptShelf: Shelf = {
  chunks: 'recorded_content_chunks',
  heads: 'recorded_content_heads',
  places: 'recorded_content_places',
  chunkMissing: (sha256, index) => new Error(`The content kept under ${sha256} is missing its chunk ${index}`),
};

interface ContentTable {
  readonly name: string;
  readonly create: (dialect: ContentDialect) => SQL;
}

const chunkTable: ContentTable = {
  name: keptShelf.chunks,
  create: ({ bytesType }) => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(keptShelf.chunks)} (
      place_key TEXT NOT NULL,
      upload_id TEXT NOT NULL,
      chunk INTEGER NOT NULL,
      data ${SQL.plain(bytesType)} NOT NULL,
      PRIMARY KEY (place_key, upload_id, chunk)
    )`,
};

const headTable: ContentTable = {
  name: keptShelf.heads,
  create: () => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(keptShelf.heads)} (
      org_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      place_key TEXT NOT NULL,
      upload_id TEXT NOT NULL,
      bytes BIGINT NOT NULL,
      chunks INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      kept_at BIGINT NOT NULL DEFAULT 0,
      kept_in TEXT NOT NULL DEFAULT 'ledger',
      removing_since BIGINT,
      expires_at BIGINT,
      erased_at BIGINT,
      PRIMARY KEY (org_key, sha256)
    )`,
};

const placeTable: ContentTable = {
  name: keptShelf.places,
  create: () => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(keptShelf.places)} (
      org_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      place_key TEXT NOT NULL,
      PRIMARY KEY (org_key, sha256, place_key)
    )`,
};

const contentTables: readonly ContentTable[] = [chunkTable, headTable, placeTable];

export const contentTableNames: readonly string[] = contentTables.map(({ name }) => name);

const uploadIndex: PlaybookIndex = {
  name: `${keptShelf.heads}_by_upload`,
  create: () =>
    SQL`CREATE INDEX IF NOT EXISTS ${SQL.identifier(`${keptShelf.heads}_by_upload`)} ON ${SQL.identifier(keptShelf.heads)} (place_key, upload_id)`,
};

const expiringIndex: PlaybookIndex = {
  name: `${keptShelf.heads}_expiring`,
  create: () =>
    SQL`CREATE INDEX IF NOT EXISTS ${SQL.identifier(`${keptShelf.heads}_expiring`)} ON ${SQL.identifier(keptShelf.heads)} (expires_at) WHERE expires_at IS NOT NULL`,
};

const contentIndexes: readonly PlaybookIndex[] = [uploadIndex, expiringIndex];

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

export function orgKeyOf({ org }: ContentOwner): string {
  return streamPrefixOfOrg({ org });
}

export function theContent(owner: ContentOwner, sha256: string): SQL {
  return SQL`org_key = ${orgKeyOf(owner)} AND sha256 = ${sha256}`;
}

const PlaceRows = Schema.Array(Schema.Struct({ place_key: Schema.String }));

export function placesRead(
  execute: StatementExecutor,
  { places }: Shelf,
  owner: ContentOwner,
  sha256: string,
): Effect.Effect<readonly string[]> {
  return Effect.promise(async () => {
    const { rows } = await execute.query(
      SQL`SELECT place_key FROM ${SQL.identifier(places)} WHERE ${theContent(owner, sha256)} ORDER BY place_key`,
    );
    return Schema.decodeUnknownSync(PlaceRows)(rows).map(({ place_key }) => place_key);
  });
}

interface PlacedContent {
  readonly owner: ContentOwner;
  readonly sha256: string;
  readonly place: string;
}

export function placeRecorded(
  execute: StatementExecutor,
  { places }: Shelf,
  { owner, sha256, place }: PlacedContent,
): Effect.Effect<void> {
  return Effect.asVoid(
    Effect.promise(() =>
      execute.command(
        SQL`INSERT INTO ${SQL.identifier(places)} (org_key, sha256, place_key) VALUES (${orgKeyOf(owner)}, ${sha256}, ${place})
          ON CONFLICT (org_key, sha256, place_key) DO NOTHING`,
      ),
    ),
  );
}
