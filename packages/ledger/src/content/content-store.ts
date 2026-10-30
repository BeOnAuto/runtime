import { SQL } from '@event-driven-io/dumbo';
import {
  leftUnread,
  mostContentChunkBytes,
  randomUUIDv7,
  requireExpected,
  stagingEnded,
  takenInChunks,
  type ContentKept,
  type ContentStore,
  type ContentRefused,
  type ContentToKeep,
  type RecordedContent,
  type StagingEnded,
  type Taken,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { inTransactionOf, type InTransaction, type StatementExecutor, type TransactionalPool } from '../event-store.ts';
import { sqliteContent, type ContentDialect } from './content-dialects.ts';
import {
  playbookPlaceOf,
  columnsOf,
  commanded,
  headOf,
  hexOf,
  matching,
  queried,
  readOn,
  runPlaceOf,
  uploadOf,
  uploadRemoved,
  valuesOf,
  type Key,
  type KeptHead,
  type Shelved,
} from './content-places.ts';
import { contentSweepOn } from './content-sweep.ts';
import { keptShelf, stagingShelf, unstagedRuns } from './content-tables.ts';

interface Placed {
  readonly uploadId: string;
  readonly head: KeptHead | undefined;
}

interface ChunkWriting {
  readonly take: (chunk: Readonly<Uint8Array>) => Effect.Effect<void>;
  readonly written: () => number;
  readonly flushed: () => Effect.Effect<void>;
}

const UnstagedRows = Schema.Array(Schema.Struct({ run_id: Schema.String }));

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

function unstagedOf(shelved: Shelved, place: Key): Effect.Effect<boolean> {
  return Effect.map(
    queried(shelved, SQL`SELECT run_id FROM ${SQL.identifier(unstagedRuns)} WHERE ${matching(place)}`),
    (rows) => Schema.decodeUnknownSync(UnstagedRows)(rows).length > 0,
  );
}

function stagingOpen(shelved: Shelved, place: Key, run: string): Effect.Effect<void, StagingEnded> {
  return Effect.flatMap(unstagedOf(shelved, place), (unstaged) =>
    unstaged ? Effect.fail(stagingEnded(run)) : Effect.void,
  );
}

function stagedOn(
  shelved: Shelved,
  { place, run }: { readonly place: Key; readonly run: string },
  content: ContentToKeep,
): Effect.Effect<ContentKept, ContentRefused | StagingEnded> {
  return Effect.gen(function* () {
    yield* stagingOpen(shelved, place, run).pipe(Effect.tapError(() => leftUnread(content.stream)));
    const placed = yield* placedOn(shelved, place, content);
    if (yield* unstagedOf(shelved, place)) {
      yield* commanded(
        shelved,
        SQL`DELETE FROM ${SQL.identifier(shelved.shelf.heads)} WHERE ${matching(uploadOf(place, placed.uploadId))}`,
      );
      yield* uploadRemoved(shelved, place, { uploadId: placed.uploadId, sha256: undefined });
      return yield* Effect.fail(stagingEnded(run));
    }
    return yield* keptOf(placed);
  });
}

function unstagedOn(shelved: Shelved, place: Key, inTransaction: InTransaction): Effect.Effect<void> {
  const { heads, chunks } = shelved.shelf;
  return Effect.andThen(
    commanded(
      shelved,
      SQL`INSERT INTO ${SQL.identifier(unstagedRuns)} (${columnsOf(place)}) VALUES (${valuesOf(place)})
        ON CONFLICT DO NOTHING`,
    ),
    Effect.promise(() =>
      inTransaction(async (execute) => {
        await execute.command(SQL`DELETE FROM ${SQL.identifier(heads)} WHERE ${matching(place)}`);
        await execute.command(SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE ${matching(place)}`);
      }),
    ),
  );
}

export function recordedContentOn(
  execute: StatementExecutor,
  dialect: ContentDialect,
  inTransaction: InTransaction,
): RecordedContent {
  const keeping: Shelved = { execute, dialect, shelf: keptShelf };
  const staging: Shelved = { execute, dialect, shelf: stagingShelf };
  return {
    put: (playbook, content) => Effect.flatMap(placedOn(keeping, playbookPlaceOf(playbook), content), keptOf),
    get: (playbook, sha256) => readOn(keeping, playbookPlaceOf(playbook), sha256),
    stage: (playbook, run, content) => stagedOn(staging, { place: runPlaceOf(playbook, run), run }, content),
    staged: (playbook, run, sha256) => readOn(staging, runPlaceOf(playbook, run), sha256),
    unstage: (playbook, run) => unstagedOn(staging, runPlaceOf(playbook, run), inTransaction),
  };
}

export function sqliteContentOn(pool: TransactionalPool): ContentStore {
  return {
    content: recordedContentOn(pool.execute, sqliteContent, inTransactionOf(pool)),
    sweepContent: contentSweepOn(pool.execute),
  };
}
