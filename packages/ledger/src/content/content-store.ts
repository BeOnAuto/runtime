import { SQL } from '@event-driven-io/dumbo';
import {
  mostContentChunkBytes,
  randomUUIDv7,
  requireExpected,
  takenInChunks,
  type ContentKept,
  type ContentStore,
  type ContentRefused,
  type ContentToKeep,
  type RecordedContent,
  type Taken,
} from '@on.auto/operations';
import { Effect } from 'effect';

import type { StatementExecutor, TransactionalPool } from '../event-store.ts';
import { sqliteContent, type ContentDialect } from './content-dialects.ts';
import {
  playbookPlaceOf,
  columnsOf,
  commanded,
  headOf,
  hexOf,
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

interface Placed {
  readonly uploadId: string;
  readonly head: KeptHead | undefined;
}

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

function readAlone(): Effect.Effect<void> {
  return Effect.void;
}

function headWritten(
  shelved: Shelved,
  place: Key,
  uploadId: string,
  { taken, mediaType }: { readonly taken: Taken; readonly mediaType: string },
): Effect.Effect<void> {
  return commanded(
    shelved,
    SQL`INSERT INTO ${SQL.identifier(shelved.shelf.heads)} (${columnsOf(place, 'sha256', 'upload_id', 'bytes', 'chunks', 'media_type')})
      VALUES (${valuesOf(place)}, ${taken.sha256}, ${uploadId}, ${taken.bytes}, ${taken.chunks}, ${mediaType})
      ON CONFLICT DO NOTHING`,
  );
}

function placedAfter(
  shelved: Shelved,
  place: Key,
  uploadId: string,
  { taken, mediaType, writing }: { readonly taken: Taken; readonly mediaType: string; readonly writing: ChunkWriting },
): Effect.Effect<KeptHead | undefined> {
  return Effect.gen(function* () {
    const held = writing.written() === 0 ? yield* headOf(shelved, place, taken.sha256) : undefined;
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

function placedOn(
  shelved: Shelved,
  place: Key,
  { stream, mediaType, expected }: ContentToKeep,
): Effect.Effect<Placed, ContentRefused> {
  return Effect.suspend(() => {
    const uploadId = randomUUIDv7();
    let digested: string | undefined;
    return Effect.gen(function* () {
      const held = expected?.sha256 === undefined ? undefined : yield* headOf(shelved, place, expected.sha256);
      const writing = chunkWritingOf(shelved, uploadOf(place, uploadId));
      const taken = yield* takenInChunks(stream, mostContentChunkBytes, held === undefined ? writing.take : readAlone);
      digested = taken.sha256;
      yield* requireExpected(expected, taken);
      const head = held ?? (yield* placedAfter(shelved, place, uploadId, { taken, mediaType, writing }));
      return { uploadId, head };
    }).pipe(Effect.onError(() => uploadRemoved(shelved, place, { uploadId, sha256: digested })));
  });
}

function keptOf({ head }: Placed): Effect.Effect<ContentKept> {
  return head === undefined
    ? Effect.die(new Error('No head names the content just put, though nothing deletes what is kept'))
    : Effect.succeed({ sha256: head.sha256, bytes: head.bytes, mediaType: head.mediaType });
}

export function recordedContentOn(execute: StatementExecutor, dialect: ContentDialect): RecordedContent {
  const keeping: Shelved = { execute, dialect, shelf: keptShelf };
  return {
    put: (playbook, content) => Effect.flatMap(placedOn(keeping, playbookPlaceOf(playbook), content), keptOf),
    get: (playbook, sha256) => readOn(keeping, playbookPlaceOf(playbook), sha256),
  };
}

export function sqliteContentOn(pool: TransactionalPool): ContentStore {
  return {
    content: recordedContentOn(pool.execute, sqliteContent),
    sweepContent: contentSweepOn(pool.execute),
  };
}
