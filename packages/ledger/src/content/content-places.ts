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
  type ContentOwner,
  type ContentPart,
  type KeptContentHead,
  type StreamedContent,
} from '@on.auto/content';
import { Clock, Effect, Schema } from 'effect';

import type { OwnRemoval, ReturningExecutor, StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { ContentDialect } from './content-dialects.ts';
import { expiryKept, keptHeadColumns, keptHeadIn, keptInTheLedger, theContent, type Shelf } from './content-tables.ts';

export interface Upload {
  readonly placeKey: string;
  readonly uploadId: string;
}

export interface KeptHead extends ContentKept, Upload {
  readonly chunks: number;
}

export interface Shelved {
  readonly execute: ReturningExecutor;
  readonly dialect: ContentDialect;
  readonly shelf: Shelf;
}

const HeadRows = Schema.Array(
  Schema.Struct({
    place_key: Schema.String,
    upload_id: Schema.String,
    bytes: Schema.Number,
    chunks: Schema.Number,
    media_type: Schema.String,
  }),
);

const StoredBytes = Schema.Union([Schema.Uint8Array, Schema.instanceOf(ArrayBuffer)]);

const ChunkRows = Schema.Array(Schema.Struct({ data: StoredBytes }));

const RemovedUploadRows = Schema.Array(Schema.Struct({ place_key: Schema.String, upload_id: Schema.String }));

function theUpload({ placeKey, uploadId }: Upload): SQL {
  return SQL`place_key = ${placeKey} AND upload_id = ${uploadId}`;
}

function viewOf(stored: Readonly<Uint8Array> | Readonly<ArrayBuffer>): Uint8Array {
  return stored instanceof Uint8Array ? stored : new Uint8Array(stored);
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

const headColumns = SQL.plain('place_key, upload_id, CAST(bytes AS DOUBLE PRECISION) AS bytes, chunks, media_type');

function headIn(rows: readonly unknown[], sha256: string): KeptHead | undefined {
  const head = Schema.decodeUnknownSync(HeadRows)(rows).at(0);
  return head === undefined
    ? undefined
    : {
        sha256,
        placeKey: head.place_key,
        uploadId: head.upload_id,
        bytes: head.bytes,
        chunks: head.chunks,
        mediaType: head.media_type,
      };
}

export function headOf(shelved: Shelved, owner: ContentOwner, sha256: string): Effect.Effect<KeptHead | undefined> {
  return Effect.map(
    queried(
      shelved,
      SQL`SELECT ${headColumns} FROM ${SQL.identifier(shelved.shelf.heads)}
        WHERE ${theContent(owner, sha256)} AND kept_in = ${keptInTheLedger} AND erased_at IS NULL`,
    ),
    (rows) => headIn(rows, sha256),
  );
}

export function keptHeadOn(
  shelved: Shelved,
  owner: ContentOwner,
  sha256: string,
): Effect.Effect<KeptContentHead | undefined> {
  return Effect.map(
    queried(
      shelved,
      SQL`SELECT ${keptHeadColumns} FROM ${SQL.identifier(shelved.shelf.heads)}
        WHERE ${theContent(owner, sha256)} AND kept_in = ${keptInTheLedger}`,
    ),
    keptHeadIn,
  );
}

export function headTouched(
  shelved: Shelved,
  owner: ContentOwner,
  sha256: string,
  expiresAt: number | undefined,
): Effect.Effect<KeptHead | undefined> {
  return Effect.flatMap(Clock.currentTimeMillis, (keptAt) =>
    Effect.map(
      written(
        shelved,
        SQL`UPDATE ${SQL.identifier(shelved.shelf.heads)}
          SET kept_at = ${keptAt}, expires_at = ${expiryKept(SQL`expires_at`, expiresAt)}
          WHERE ${theContent(owner, sha256)} AND kept_in = ${keptInTheLedger} AND erased_at IS NULL
          RETURNING ${headColumns}`,
      ),
      (rows) => headIn(rows, sha256),
    ),
  );
}

async function chunkOf({ execute, shelf }: Shelved, upload: Upload, index: number): Promise<Uint8Array | undefined> {
  const { rows } = await execute.query(
    SQL`SELECT data FROM ${SQL.identifier(shelf.chunks)} WHERE ${theUpload(upload)} AND chunk = ${index}`,
  );
  const chunk = Schema.decodeUnknownSync(ChunkRows)(rows).at(0);
  return chunk === undefined ? undefined : viewOf(chunk.data);
}

interface UploadOf extends Upload {
  readonly owner: ContentOwner;
  readonly sha256: string | undefined;
}

export function uploadRemoved(shelved: Shelved, { owner, sha256, ...upload }: UploadOf): Effect.Effect<void> {
  const { chunks, heads } = shelved.shelf;
  return commanded(
    shelved,
    sha256 === undefined
      ? SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE ${theUpload(upload)}`
      : SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE ${theUpload(upload)}
          AND NOT EXISTS (SELECT 1 FROM ${SQL.identifier(heads)} WHERE ${theContent(owner, sha256)} AND ${theUpload(upload)})`,
  );
}

interface StaleContent {
  readonly owner: ContentOwner;
  readonly sha256: string;
  readonly before: number;
}

export async function keptRemovedWithin(
  { chunks, heads }: Shelf,
  execute: StatementExecutor,
  { owner, sha256, before }: StaleContent,
): Promise<OwnRemoval> {
  const content = theContent(owner, sha256);
  const { rows } = await execute.query(
    SQL`DELETE FROM ${SQL.identifier(heads)} WHERE ${content} AND kept_at < ${before} RETURNING place_key, upload_id`,
  );
  const removed = Schema.decodeUnknownSync(RemovedUploadRows)(rows);
  await inTurn(removed, ({ place_key: placeKey, upload_id: uploadId }) =>
    execute.command(SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE ${theUpload({ placeKey, uploadId })}`),
  );
  if (removed.length > 0) {
    return 'removed';
  }
  const standing = await execute.query(SQL`SELECT 1 AS standing FROM ${SQL.identifier(heads)} WHERE ${content}`);
  return standing.rows.length > 0 ? 'fresh' : 'removed';
}

interface ChunksAsked {
  readonly first: number;
  readonly last: number;
  readonly within: (chunk: Readonly<Uint8Array>, index: number) => Uint8Array;
}

function chunkStreamOf(shelved: Shelved, head: KeptHead, asked: ChunksAsked): ReadableStream<Uint8Array> {
  let index = asked.first;
  return new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        if (index > asked.last) {
          controller.close();
          return;
        }
        const chunk = await chunkOf(shelved, head, index);
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

function chunksOf(shelved: Shelved, head: KeptHead): ReadableStream<Uint8Array> {
  return chunkStreamOf(shelved, head, { first: 0, last: head.chunks - 1, within: (chunk) => chunk.subarray() });
}

function chunksWithin(shelved: Shelved, head: KeptHead, { start, end }: ByteRange) {
  return chunkStreamOf(shelved, head, {
    first: Math.floor(start / mostContentChunkBytes),
    last: Math.floor(end / mostContentChunkBytes),
    within: (chunk, index) => {
      const offset = index * mostContentChunkBytes;
      return chunk.subarray(Math.max(0, start - offset), Math.min(chunk.byteLength, end - offset + 1));
    },
  });
}

export function readOn(
  shelved: Shelved,
  owner: ContentOwner,
  sha256: string,
): Effect.Effect<StreamedContent | undefined> {
  return Effect.map(headOf(shelved, owner, sha256), (head) =>
    head === undefined
      ? head
      : {
          stream: verifiedStream(sha256, head.bytes, chunksOf(shelved, head)),
          bytes: head.bytes,
          mediaType: head.mediaType,
        },
  );
}

export function readPartOn(
  shelved: Shelved,
  owner: ContentOwner,
  sha256: string,
  asked: AskedRange,
): Effect.Effect<ContentPart | undefined> {
  return Effect.map(headOf(shelved, owner, sha256), (head) =>
    head === undefined
      ? head
      : contentPartOf(head.bytes, head.mediaType, asked, (range) =>
          measuredStream(sha256, bytesIn(range), chunksWithin(shelved, head, range)),
        ),
  );
}
