import { SQL } from '@event-driven-io/dumbo';
import {
  mostContentChunkBytes,
  requireExpected,
  takenInChunks,
  type ContentKept,
  type ContentRefused,
  type ContentToKeep,
  type Taken,
} from '@on.auto/content';
import { randomUUIDv7 } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import type { OwnContentStore, StatementExecutor, TransactionalPool } from '../event-store.ts';
import { sqliteContent, type ContentDialect } from './content-dialects.ts';
import {
  playbookPlaceOf,
  columnsOf,
  commanded,
  headOf,
  headTouched,
  keptInTheLedger,
  hexOf,
  keptRemovedWithin,
  readOn,
  uploadOf,
  uploadRemoved,
  valuesOf,
  type Key,
  type KeptHead,
  type Shelved,
} from './content-places.ts';
import { contentSweepOn } from './content-sweep.ts';
import { keptShelf } from './content-tables.ts';
import { externalHeadsOn } from './external-heads.ts';

interface ChunkWriting {
  readonly take: (chunk: Readonly<Uint8Array>) => Effect.Effect<void>;
  readonly written: () => number;
  readonly flushed: () => Effect.Effect<void>;
}

function chunkWritingOf(shelved: Shelved, upload: Key): ChunkWriting {
  let pending: Readonly<Uint8Array> | undefined;
  let written = 0;
  const write = (chunk: Readonly<Uint8Array>) =>
    Effect.suspend(() => {
      const index = written;
      written += 1;
      return commanded(
        shelved,
        SQL`INSERT INTO ${SQL.identifier(shelved.shelf.chunks)} (${columnsOf(upload, 'chunk', 'data')})
          VALUES (${valuesOf(upload)}, ${index}, ${shelved.dialect.bytesOfHex(hexOf(chunk))})`,
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

const takenOverColumns = ['upload_id', 'bytes', 'chunks', 'media_type'];

function readAlone(): Effect.Effect<void> {
  return Effect.void;
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

function headWritten(
  shelved: Shelved,
  place: Key,
  uploadId: string,
  { taken, mediaType }: { readonly taken: Taken; readonly mediaType: string },
): Effect.Effect<void> {
  return Effect.flatMap(Clock.currentTimeMillis, (keptAt) =>
    commanded(
      shelved,
      SQL`INSERT INTO ${SQL.identifier(shelved.shelf.heads)} (${columnsOf(place, 'sha256', 'upload_id', 'bytes', 'chunks', 'media_type', 'kept_at')})
        VALUES (${valuesOf(place)}, ${taken.sha256}, ${uploadId}, ${taken.bytes}, ${taken.chunks}, ${mediaType}, ${keptAt})
        ON CONFLICT (${columnsOf(place, 'sha256')}) DO UPDATE SET kept_at = excluded.kept_at, ${externalTakenOver(shelved)}`,
    ),
  );
}

function placedAfter(
  shelved: Shelved,
  place: Key,
  uploadId: string,
  { taken, mediaType, writing }: { readonly taken: Taken; readonly mediaType: string; readonly writing: ChunkWriting },
): Effect.Effect<KeptHead | undefined> {
  return Effect.gen(function* () {
    const held = writing.written() === 0 ? yield* headTouched(shelved, place, taken.sha256) : undefined;
    if (held !== undefined) {
      return held;
    }
    yield* writing.flushed();
    yield* headWritten(shelved, place, uploadId, { taken, mediaType });
    const head = yield* headOf(shelved, place, taken.sha256);
    if (head?.uploadId !== uploadId) {
      yield* uploadRemoved(shelved, place, { uploadId, sha256: taken.sha256 });
    }
    return head;
  });
}

function keptOf(head: ContentKept | undefined, { sha256, bytes }: Taken, mediaType: string): ContentKept {
  return head === undefined ? { sha256, bytes, mediaType } : { sha256, bytes: head.bytes, mediaType: head.mediaType };
}

function placedOn(
  shelved: Shelved,
  place: Key,
  { stream, mediaType, expected }: ContentToKeep,
): Effect.Effect<ContentKept, ContentRefused> {
  return Effect.suspend(() => {
    const uploadId = randomUUIDv7();
    let digested: string | undefined;
    return Effect.gen(function* () {
      const held = expected?.sha256 === undefined ? undefined : yield* headTouched(shelved, place, expected.sha256);
      const writing = chunkWritingOf(shelved, uploadOf(place, uploadId));
      const taken = yield* takenInChunks(stream, mostContentChunkBytes, held === undefined ? writing.take : readAlone);
      digested = taken.sha256;
      yield* requireExpected(expected, taken);
      const head = held ?? (yield* placedAfter(shelved, place, uploadId, { taken, mediaType, writing }));
      return keptOf(head, taken, mediaType);
    }).pipe(Effect.onError(() => uploadRemoved(shelved, place, { uploadId, sha256: digested })));
  });
}

const removalWithin: OwnContentStore['removalWithin'] = (playbook, sha256, before) => (within) =>
  keptRemovedWithin(keptShelf, within, { place: playbookPlaceOf(playbook), sha256, before });

export function contentStoreOn(execute: StatementExecutor, dialect: ContentDialect): OwnContentStore {
  const keeping: Shelved = { execute, dialect, shelf: keptShelf };
  return {
    content: {
      put: (playbook, content) => placedOn(keeping, playbookPlaceOf(playbook), content),
      get: (playbook, sha256) => readOn(keeping, playbookPlaceOf(playbook), sha256),
    },
    removalWithin,
    sweepContent: contentSweepOn(execute),
    externalHeadsWith: (unlessHeld) => externalHeadsOn(execute, unlessHeld),
  };
}

export function sqliteContentOn(pool: TransactionalPool): OwnContentStore {
  return contentStoreOn(pool.execute, sqliteContent);
}
