import { SQL } from '@event-driven-io/dumbo';
import {
  streamPrefixOfPlaybook,
  verifiedStream,
  type PlaybookAddress,
  type ContentKept,
  type StreamedContent,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import type { ContentDialect } from './content-dialects.ts';
import type { Shelf } from './content-tables.ts';

export type Key = readonly (readonly [column: string, value: string])[];

export interface KeptHead extends ContentKept {
  readonly uploadId: string;
  readonly chunks: number;
}

export interface Shelved {
  readonly execute: StatementExecutor;
  readonly dialect: ContentDialect;
  readonly shelf: Shelf;
}

const HeadRows = Schema.Array(
  Schema.Struct({ upload_id: Schema.String, bytes: Schema.Number, chunks: Schema.Number, media_type: Schema.String }),
);

const StoredBytes = Schema.Union([Schema.Uint8Array, Schema.instanceOf(ArrayBuffer)]);

const ChunkRows = Schema.Array(Schema.Struct({ data: StoredBytes }));

function viewOf(stored: Readonly<Uint8Array> | Readonly<ArrayBuffer>): Uint8Array {
  return stored instanceof Uint8Array ? stored : new Uint8Array(stored);
}

export function matching(key: Key): SQL {
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

export function queried({ execute }: Shelved, sql: SQL): Effect.Effect<readonly unknown[]> {
  return Effect.promise(async () => (await execute.query(sql)).rows);
}

export function commanded({ execute }: Shelved, sql: SQL): Effect.Effect<void> {
  return Effect.asVoid(Effect.promise(() => execute.command(sql)));
}

export function headOf(shelved: Shelved, place: Key, sha256: string): Effect.Effect<KeptHead | undefined> {
  return Effect.map(
    queried(
      shelved,
      SQL`SELECT upload_id, CAST(bytes AS DOUBLE PRECISION) AS bytes, chunks, media_type
        FROM ${SQL.identifier(shelved.shelf.heads)} WHERE ${matching(place)} AND sha256 = ${sha256}`,
    ),
    (rows) => {
      const head = Schema.decodeUnknownSync(HeadRows)(rows).at(0);
      return head === undefined
        ? undefined
        : { sha256, uploadId: head.upload_id, bytes: head.bytes, chunks: head.chunks, mediaType: head.media_type };
    },
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

function chunksOf(shelved: Shelved, place: Key, head: KeptHead): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        if (index === head.chunks) {
          controller.close();
          return;
        }
        const chunk = await chunkOf(shelved, uploadOf(place, head.uploadId), index);
        if (chunk === undefined) {
          controller.error(shelved.shelf.chunkMissing(head.sha256, index));
          return;
        }
        index += 1;
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 },
  );
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

export function playbookPlaceOf(playbook: PlaybookAddress): Key {
  return [['playbook_key', streamPrefixOfPlaybook(playbook)]];
}

export function runPlaceOf(playbook: PlaybookAddress, run: string): Key {
  return [...playbookPlaceOf(playbook), ['run_id', run]];
}
