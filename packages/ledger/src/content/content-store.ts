import { SQL } from '@event-driven-io/dumbo';
import {
  expiryOf,
  mostContentChunkBytes,
  requireExpected,
  takenInChunks,
  type ContentKept,
  type ContentOwner,
  type ContentRefused,
  type ContentToKeep,
  type Taken,
} from '@on.auto/content';
import { randomUUIDv7 } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import type { OwnContentStore, ReturningExecutor, TransactionalPool } from '../event-store.ts';
import { sqliteContent, type ContentDialect } from './content-dialects.ts';
import {
  commanded,
  headOf,
  headTouched,
  hexOf,
  keptHeadOn,
  keptRemovedWithin,
  readOn,
  readPartOn,
  uploadRemoved,
  type KeptHead,
  type Shelved,
  type Upload,
} from './content-places.ts';
import { contentSweepOn, ownExpiredErasedOn } from './content-sweep.ts';
import { expiryKeptOver, expiryOfThePut, keptInTheLedger, keptShelf, laterExpiry, orgKeyOf } from './content-tables.ts';
import { externalHeadsOn } from './external-heads.ts';

interface ChunkWriting {
  readonly take: (chunk: Readonly<Uint8Array>) => Effect.Effect<void>;
  readonly written: () => number;
  readonly flushed: () => Effect.Effect<void>;
}

function chunkWritingOf(shelved: Shelved, { placeKey, uploadId }: Upload): ChunkWriting {
  let pending: Readonly<Uint8Array> | undefined;
  let written = 0;
  const write = (chunk: Readonly<Uint8Array>) =>
    Effect.suspend(() => {
      const index = written;
      written += 1;
      return commanded(
        shelved,
        SQL`INSERT INTO ${SQL.identifier(shelved.shelf.chunks)} (place_key, upload_id, chunk, data)
          VALUES (${placeKey}, ${uploadId}, ${index}, ${shelved.dialect.bytesOfHex(hexOf(chunk))})`,
      );
    });
  return {
    take: (chunk) =>
      Effect.suspend(() => {
        const previous = pending;
        pending = chunk;
        return previous === undefined ? Effect.void : write(previous);
      }),
    written: () => written,
    flushed: () => Effect.suspend(() => (pending === undefined ? Effect.void : write(pending))),
  };
}

const takenOverColumns = ['place_key', 'upload_id', 'bytes', 'chunks', 'media_type'];

function readAlone(): Effect.Effect<void> {
  return Effect.void;
}

function takenOverUnlessItStands({ shelf }: Shelved): SQL {
  const heads = SQL.identifier(shelf.heads);
  const stands = SQL`${heads}.kept_in = ${keptInTheLedger} AND ${heads}.erased_at IS NULL`;
  return SQL.merge(
    [
      ...takenOverColumns.map(
        (column) =>
          SQL`${SQL.identifier(column)} = CASE WHEN ${stands} THEN ${heads}.${SQL.identifier(column)} ELSE excluded.${SQL.identifier(column)} END`,
      ),
      SQL`removing_since = CASE WHEN ${stands} THEN ${heads}.removing_since END`,
      SQL`kept_in = ${keptInTheLedger}`,
      SQL`erased_at = NULL`,
    ],
    ', ',
  );
}

function externalTakenOver({ shelf }: Shelved): SQL {
  const heads = SQL.identifier(shelf.heads);
  const own = SQL`${heads}.kept_in = ${keptInTheLedger}`;
  return SQL.merge(
    [
      ...takenOverColumns.map(
        (column) =>
          SQL`${SQL.identifier(column)} = CASE WHEN ${own} THEN ${heads}.${SQL.identifier(column)} ELSE excluded.${SQL.identifier(column)} END`,
      ),
      SQL`removing_since = CASE WHEN ${own} THEN ${heads}.removing_since END`,
      SQL`kept_in = ${keptInTheLedger}`,
    ],
    ', ',
  );
}

interface HeadWriting {
  readonly taken: Taken;
  readonly mediaType: string;
  readonly expiresAt: number | undefined;
}

interface HeadPut extends HeadWriting, Upload {
  readonly owner: ContentOwner;
  readonly keptAt: number;
}

function headInserted({ shelf }: Shelved, put: HeadPut, withExpiry: boolean): SQL {
  const { owner, taken, mediaType, expiresAt, placeKey, uploadId, keptAt } = put;
  const expiring = withExpiry ? SQL`, expires_at` : SQL``;
  const values = [
    SQL`${orgKeyOf(owner)}, ${taken.sha256}, ${placeKey}, ${uploadId}, ${taken.bytes}, ${taken.chunks}, ${mediaType}, ${keptAt}`,
    ...(withExpiry ? [expiryOfThePut(expiresAt)] : []),
  ];
  return SQL`INSERT INTO ${SQL.identifier(shelf.heads)} (org_key, sha256, place_key, upload_id, bytes, chunks, media_type, kept_at${expiring})
    VALUES (${SQL.merge(values, ', ')})`;
}

function headWritten(shelved: Shelved, put: HeadPut): Effect.Effect<boolean> {
  const heads = SQL.identifier(shelved.shelf.heads);
  const later = laterExpiry(SQL`${heads}.expires_at`, SQL`excluded.expires_at`);
  const sql = SQL`${headInserted(shelved, put, put.expiresAt !== undefined)}
    ON CONFLICT (org_key, sha256) DO UPDATE SET kept_at = excluded.kept_at,
      expires_at = ${put.expiresAt === undefined ? SQL`NULL` : later}, ${externalTakenOver(shelved)}
    WHERE ${heads}.erased_at IS NULL
    RETURNING upload_id`;
  return Effect.promise(async () => (await shelved.execute.command(sql)).rows.length > 0);
}

function headWrittenOverWhatStands(shelved: Shelved, put: HeadPut): Effect.Effect<void> {
  return commanded(
    shelved,
    SQL`${headInserted(shelved, put, true)}
      ON CONFLICT (org_key, sha256) DO UPDATE SET kept_at = excluded.kept_at,
        expires_at = ${expiryKeptOver(shelved.shelf.heads)}, ${takenOverUnlessItStands(shelved)}`,
  );
}

function placedAfter(
  shelved: Shelved,
  keeping: Keeping,
  { writing, ...writes }: HeadWriting & { readonly writing: ChunkWriting },
): Effect.Effect<KeptHead | undefined> {
  const { owner, upload } = keeping;
  return Effect.gen(function* () {
    const { taken, expiresAt } = writes;
    const held = writing.written() === 0 ? yield* headTouched(shelved, owner, taken.sha256, expiresAt) : undefined;
    if (held !== undefined) {
      return held;
    }
    yield* writing.flushed();
    const put = { ...writes, ...upload, owner, keptAt: yield* Clock.currentTimeMillis };
    const wrote = yield* headWritten(shelved, put);
    yield* wrote ? Effect.void : headWrittenOverWhatStands(shelved, put);
    const head = yield* headOf(shelved, owner, taken.sha256);
    if (head?.uploadId !== upload.uploadId) {
      yield* uploadRemoved(shelved, { ...upload, owner, sha256: taken.sha256 });
    }
    return head;
  });
}

function keptOf(head: ContentKept | undefined, { sha256, bytes }: Taken, mediaType: string): ContentKept {
  return head === undefined ? { sha256, bytes, mediaType } : { sha256, bytes: head.bytes, mediaType: head.mediaType };
}

interface Keeping {
  readonly owner: ContentOwner;
  readonly upload: Upload;
}

function placedOn(
  shelved: Shelved,
  owner: ContentOwner,
  content: ContentToKeep,
  expiresAt: number | undefined,
): Effect.Effect<ContentKept, ContentRefused> {
  const { stream, mediaType, expected } = content;
  return Effect.suspend(() => {
    const upload: Upload = { placeKey: orgKeyOf(owner), uploadId: randomUUIDv7() };
    let digested: string | undefined;
    return Effect.gen(function* () {
      const held =
        expected?.sha256 === undefined ? undefined : yield* headTouched(shelved, owner, expected.sha256, expiresAt);
      const writing = chunkWritingOf(shelved, upload);
      const taken = yield* takenInChunks(stream, mostContentChunkBytes, held === undefined ? writing.take : readAlone);
      digested = taken.sha256;
      yield* requireExpected(expected, taken);
      const head = held ?? (yield* placedAfter(shelved, { owner, upload }, { taken, mediaType, expiresAt, writing }));
      return keptOf(head, taken, mediaType);
    }).pipe(Effect.onError(() => uploadRemoved(shelved, { ...upload, owner, sha256: digested })));
  });
}

const removalWithin: OwnContentStore['removalWithin'] = (owner, sha256, before) => (within) =>
  keptRemovedWithin(keptShelf, within, { owner, sha256, before });

export function contentStoreOn(execute: ReturningExecutor, dialect: ContentDialect): OwnContentStore {
  const keeping: Shelved = { execute, dialect, shelf: keptShelf };
  return {
    content: {
      put: (owner, content) =>
        Effect.flatMap(expiryOf(content), (expiresAt) => placedOn(keeping, owner, content, expiresAt)),
      get: (owner, sha256) => readOn(keeping, owner, sha256),
      getHead: (owner, sha256) => keptHeadOn(keeping, owner, sha256),
      getPart: (owner, sha256, asked) => readPartOn(keeping, owner, sha256, asked),
    },
    contentFound: (owner, sha256) => Effect.map(keptHeadOn(keeping, owner, sha256), (head) => head !== undefined),
    removalWithin,
    sweepContent: contentSweepOn(execute),
    eraseExpired: ownExpiredErasedOn(execute),
    externalHeadsWith: (unlessHeld) => externalHeadsOn(execute, unlessHeld),
  };
}

export function sqliteContentOn(pool: TransactionalPool<ReturningExecutor>): OwnContentStore {
  return contentStoreOn(pool.execute, sqliteContent);
}
