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
import { Effect } from 'effect';

import type { Bucket, ObjectHead } from '../bucket/bucket.ts';
import type { ObjectKeys } from '../location/object-keys.ts';
import { uploadWritingOf, type UploadWriting } from './upload-writing.ts';

export interface Placing {
  readonly bucket: Bucket;
  readonly keys: ObjectKeys;
}

type KeyOf = (sha256: string) => string;

interface Written {
  readonly taken: Taken;
  readonly mediaType: string;
  readonly writing: UploadWriting;
  readonly upload: string;
}

function heldOf(bucket: Bucket, key: string): Effect.Effect<ObjectHead | undefined> {
  return Effect.promise(() => bucket.head(key));
}

function keptAt(bucket: Bucket, key: string, put: ContentKept): Effect.Effect<ContentKept> {
  return Effect.map(heldOf(bucket, key), (held) => (held === undefined ? put : { sha256: put.sha256, ...held }));
}

function readAlone(): Effect.Effect<void> {
  return Effect.void;
}

function placedFirst(bucket: Bucket, key: string, { mediaType, writing, upload }: Written): Effect.Effect<boolean> {
  return writing.uploading()
    ? Effect.promise(async () => {
        const first = await bucket.put(key, { copyOf: upload, ifAbsent: true });
        await bucket.delete([upload]);
        return first;
      })
    : Effect.promise(() => bucket.put(key, { data: writing.inHand(), mediaType, ifAbsent: true }));
}

function keptAfter(bucket: Bucket, keyOf: KeyOf, written: Written): Effect.Effect<ContentKept> {
  const { sha256, bytes } = written.taken;
  const key = keyOf(sha256);
  return Effect.gen(function* () {
    const held = yield* heldOf(bucket, key);
    if (held !== undefined) {
      yield* Effect.promise(() => bucket.delete(written.writing.uploading() ? [written.upload] : []));
      return { sha256, ...held };
    }
    const put = { sha256, bytes, mediaType: written.mediaType };
    return (yield* placedFirst(bucket, key, written)) ? put : yield* keptAt(bucket, key, put);
  });
}

function heldDigestRead(
  { stream, expected }: ContentToKeep,
  held: ObjectHead,
): Effect.Effect<ContentKept, ContentRefused> {
  return Effect.gen(function* () {
    const taken = yield* takenInChunks(stream, mostContentChunkBytes, readAlone);
    yield* requireExpected(expected, taken);
    return { sha256: taken.sha256, ...held };
  });
}

function writtenOut(
  bucket: Bucket,
  upload: string,
  keyOf: KeyOf,
  { stream, mediaType, expected }: ContentToKeep,
): Effect.Effect<ContentKept, ContentRefused> {
  const writing = uploadWritingOf({ bucket, key: upload, mediaType });
  return Effect.gen(function* () {
    const taken = yield* takenInChunks(stream, mostContentChunkBytes, writing.take);
    yield* writing.finished();
    yield* requireExpected(expected, taken);
    return yield* keptAfter(bucket, keyOf, { taken, mediaType, writing, upload });
  }).pipe(Effect.onError(() => writing.abandoned()));
}

export function placedOn(
  { bucket, keys }: Placing,
  keyOf: KeyOf,
  content: ContentToKeep,
): Effect.Effect<ContentKept, ContentRefused> {
  return Effect.gen(function* () {
    const { expected } = content;
    const held = expected?.sha256 === undefined ? undefined : yield* heldOf(bucket, keyOf(expected.sha256));
    return yield* held === undefined
      ? writtenOut(bucket, keys.upload(randomUUIDv7()), keyOf, content)
      : heldDigestRead(content, held);
  });
}
