import { SQL } from '@event-driven-io/dumbo';
import {
  bytesIn,
  contentPartOf,
  measuredStream,
  mostContentChunkBytes,
  verifiedStream,
  type AskedRange,
  type ByteRange,
  type ContentKept,
  type ContentPart,
  type KeptContentHead,
  type StreamedContent,
} from '@on.auto/content';
import { streamPrefixOfPlaybook, type PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect, Schema } from 'effect';

import type { OwnRemoval, ReturningExecutor, StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { ContentDialect } from './content-dialects.ts';
import { expiryKept, keptHeadColumns, keptHeadIn, keptInTheLedger, type Shelf } from './content-tables.ts';

export type Key = readonly (readonly [column: string, value: string])[];

export interface KeptHead extends ContentKept {
  readonly uploadId: string;
  readonly chunks: number;
}

export interface Shelved {
  readonly execute: ReturningExecutor;
  readonly dialect: ContentDialect;
  readonly shelf: Shelf;
}

const HeadRows = Schema.Array(
  Schema.Struct({ upload_id: Schema.String, bytes: Schema.Number, chunks: Schema.Number, media_type: Schema.String }),
);

const StoredBytes = Schema.Union([Schema.Uint8Array, Schema.instanceOf(ArrayBuffer)]);

const ChunkRows = Schema.Array(Schema.Struct({ data: StoredBytes }));

const RemovedUploadRows = Schema.Array(Schema.Struct({ upload_id: Schema.String }));

function viewOf(stored: Readonly<Uint8Array> | Readonly<ArrayBuffer>): Uint8Array {
  return stored instanceof Uint8Array ? stored : new Uint8Array(stored);
}

function matching(key: Key): SQL {
  return SQL.merge(
    key.map(([column, value]) => SQL`${SQL.identifier(column)} = ${value}`),
    ' AND ',
  );
}

export function columnsOf(key: Key, ...more: readonly string[]): SQL {
  return SQL.merge(
    [...key.map(([column]) => column), ...more].map((column) => SQL`${SQL.identifier(column)}`),
    ', ',
  );
}

export function valuesOf(key: Key): SQL {
  return SQL.merge(
    key.map(([, value]) => SQL`${value}`),
    ', ',
  );
}

export function hexOf(chunk: Readonly<Uint8Array>): string {
  return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('hex');
}

function queried({ execute }: Shelved, sql: SQL): Effect.Effect<readonly unknown[]> {
  return Effect.promise(async () => (await execute.query(sql)).rows);
}

export function commanded({ execute }: Shelved, sql: SQL): Effect.Effect<void> {
  return Effect.asVoid(Effect.promise(() => execute.command(sql)));
}

function written({ execute }: Shelved, sql: SQL): Effect.Effect<readonly unknown[]> {
  return Effect.promise(async () => (await execute.command(sql)).rows);
}

const headColumns = SQL.plain('upload_id, CAST(bytes AS DOUBLE PRECISION) AS bytes, chunks, media_type');

function headIn(rows: readonly unknown[], sha256: string): KeptHead | undefined {
  const head = Schema.decodeUnknownSync(HeadRows)(rows).at(0);
  return head === undefined
    ? undefined
    : { sha256, uploadId: head.upload_id, bytes: head.bytes, chunks: head.chunks, mediaType: head.media_type };
}

export function headOf(shelved: Shelved, place: Key, sha256: string): Effect.Effect<KeptHead | undefined> {
  return Effect.map(
    queried(
      shelved,
      SQL`SELECT ${headColumns} FROM ${SQL.identifier(shelved.shelf.heads)}
        WHERE ${matching(place)} AND sha256 = ${sha256} AND kept_in = ${keptInTheLedger} AND erased_at IS NULL`,
    ),
    (rows) => headIn(rows, sha256),
  );
}

export function keptHeadOn(shelved: Shelved, place: Key, sha256: string): Effect.Effect<KeptContentHead | undefined> {
  return Effect.map(
    queried(
      shelved,
      SQL`SELECT ${keptHeadColumns} FROM ${SQL.identifier(shelved.shelf.heads)}
        WHERE ${matching(place)} AND sha256 = ${sha256} AND kept_in = ${keptInTheLedger}`,
    ),
    keptHeadIn,
  );
}

export function headTouched(
  shelved: Shelved,
  place: Key,
  sha256: string,
  expiresAt: number | undefined,
): Effect.Effect<KeptHead | undefined> {
  return Effect.flatMap(Clock.currentTimeMillis, (keptAt) =>
    Effect.map(
      written(
        shelved,
        SQL`UPDATE ${SQL.identifier(shelved.shelf.heads)}
          SET kept_at = ${keptAt}, expires_at = ${expiryKept(SQL`expires_at`, expiresAt)}
          WHERE ${matching(place)} AND sha256 = ${sha256} AND kept_in = ${keptInTheLedger} AND erased_at IS NULL
          RETURNING ${headColumns}`,
      ),
      (rows) => headIn(rows, sha256),
    ),
  );
}

async function chunkOf({ execute, shelf }: Shelved, upload: Key, index: number): Promise<Uint8Array | undefined> {
  const { rows } = await execute.query(
    SQL`SELECT data FROM ${SQL.identifier(shelf.chunks)} WHERE ${matching(upload)} AND chunk = ${index}`,
  );
  const chunk = Schema.decodeUnknownSync(ChunkRows)(rows).at(0);
  return chunk === undefined ? undefined : viewOf(chunk.data);
}

export function uploadOf(place: Key, uploadId: string): Key {
  return [...place, ['upload_id', uploadId]];
}

export interface Upload {
  readonly uploadId: string;
  readonly sha256: string | undefined;
}

export function uploadRemoved(shelved: Shelved, place: Key, { uploadId, sha256 }: Upload): Effect.Effect<void> {
  const upload = uploadOf(place, uploadId);
  const { chunks, heads } = shelved.shelf;
  return commanded(
    shelved,
    sha256 === undefined
      ? SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE ${matching(upload)}`
      : SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE ${matching(upload)}
          AND NOT EXISTS (SELECT 1 FROM ${SQL.identifier(heads)} WHERE ${matching([...upload, ['sha256', sha256]])})`,
  );
}

interface StaleContent {
  readonly place: Key;
  readonly sha256: string;
  readonly before: number;
}

export async function keptRemovedWithin(
  { chunks, heads }: Shelf,
  execute: StatementExecutor,
  { place, sha256, before }: StaleContent,
): Promise<OwnRemoval> {
  const { rows } = await execute.query(
    SQL`DELETE FROM ${SQL.identifier(heads)} WHERE ${matching(place)} AND sha256 = ${sha256} AND kept_at < ${before}
      RETURNING upload_id`,
  );
  const removed = Schema.decodeUnknownSync(RemovedUploadRows)(rows);
  await inTurn(removed, ({ upload_id }) =>
    execute.command(SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE ${matching(uploadOf(place, upload_id))}`),
  );
  if (removed.length > 0) {
    return 'removed';
  }
  const standing = await execute.query(
    SQL`SELECT 1 AS standing FROM ${SQL.identifier(heads)} WHERE ${matching(place)} AND sha256 = ${sha256}`,
  );
  return standing.rows.length > 0 ? 'fresh' : 'removed';
}

interface ChunksAsked {
  readonly first: number;
  readonly last: number;
  readonly within: (chunk: Readonly<Uint8Array>, index: number) => Uint8Array;
}

function chunkStreamOf(shelved: Shelved, place: Key, head: KeptHead, asked: ChunksAsked): ReadableStream<Uint8Array> {
  let index = asked.first;
  return new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        if (index > asked.last) {
          controller.close();
          return;
        }
        const chunk = await chunkOf(shelved, uploadOf(place, head.uploadId), index);
        if (chunk === undefined) {
          controller.error(shelved.shelf.chunkMissing(head.sha256, index));
          return;
        }
        controller.enqueue(asked.within(chunk, index));
        index += 1;
      },
    },
    { highWaterMark: 0 },
  );
}

function chunksOf(shelved: Shelved, place: Key, head: KeptHead): ReadableStream<Uint8Array> {
  return chunkStreamOf(shelved, place, head, { first: 0, last: head.chunks - 1, within: (chunk) => chunk.subarray() });
}

function chunksWithin(shelved: Shelved, place: Key, head: KeptHead, { start, end }: ByteRange) {
  return chunkStreamOf(shelved, place, head, {
    first: Math.floor(start / mostContentChunkBytes),
    last: Math.floor(end / mostContentChunkBytes),
    within: (chunk, index) => {
      const offset = index * mostContentChunkBytes;
      return chunk.subarray(Math.max(0, start - offset), Math.min(chunk.byteLength, end - offset + 1));
    },
  });
}

export function readOn(shelved: Shelved, place: Key, sha256: string): Effect.Effect<StreamedContent | undefined> {
  return Effect.map(headOf(shelved, place, sha256), (head) =>
    head === undefined
      ? head
      : {
          stream: verifiedStream(sha256, head.bytes, chunksOf(shelved, place, head)),
          bytes: head.bytes,
          mediaType: head.mediaType,
        },
  );
}

export function readPartOn(
  shelved: Shelved,
  place: Key,
  sha256: string,
  asked: AskedRange,
): Effect.Effect<ContentPart | undefined> {
  return Effect.map(headOf(shelved, place, sha256), (head) =>
    head === undefined
      ? head
      : contentPartOf(head.bytes, head.mediaType, asked, (range) =>
          measuredStream(sha256, bytesIn(range), chunksWithin(shelved, place, head, range)),
        ),
  );
}

export function playbookPlaceOf(playbook: PlaybookAddress): Key {
  return [['playbook_key', streamPrefixOfPlaybook(playbook)]];
}
