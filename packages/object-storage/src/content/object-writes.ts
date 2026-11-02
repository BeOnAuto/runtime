import {
  mostContentChunkBytes,
  requireExpected,
  takenInChunks,
  type ContentOwner,
  type ContentRefused,
  type ContentToKeep,
  type StagedContent,
} from '@on.auto/content';
import { randomUUIDv7 } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Bucket } from '../bucket/bucket.ts';
import type { ObjectKeys } from '../location/object-keys.ts';
import { uploadWritingOf, type UploadWriting } from './upload-writing.ts';

export interface Placing {
  readonly bucket: Bucket;
  readonly keys: ObjectKeys;
}

interface Staged {
  readonly bucket: Bucket;
  readonly kept: string;
  readonly upload: string;
  readonly writing: UploadWriting;
}

function placedFrom({ bucket, kept, upload, writing }: Staged, mediaType: string): Effect.Effect<void> {
  return writing.uploading()
    ? Effect.promise(async () => {
        try {
          await bucket.put(kept, { copyOf: upload, mediaType, ifAbsent: true });
        } finally {
          await bucket.delete([upload]);
        }
      })
    : Effect.asVoid(Effect.promise(() => bucket.put(kept, { data: writing.inHand(), mediaType, ifAbsent: true })));
}

function discardedFrom({ bucket, upload, writing }: Staged): Effect.Effect<void> {
  return Effect.promise(() => bucket.delete(writing.uploading() ? [upload] : []));
}

export function stagedOn(
  { bucket, keys }: Placing,
  playbook: ContentOwner,
  { stream, mediaType, expected }: ContentToKeep,
): Effect.Effect<StagedContent, ContentRefused> {
  return Effect.suspend(() => {
    const upload = keys.upload(randomUUIDv7());
    const writing = uploadWritingOf({ bucket, key: upload, mediaType });
    return Effect.gen(function* () {
      const taken = yield* takenInChunks(stream, mostContentChunkBytes, writing.take);
      yield* writing.finished();
      yield* requireExpected(expected, taken);
      const staged: Staged = { bucket, kept: keys.kept(playbook, taken.sha256), upload, writing };
      return {
        taken,
        placed: (placedAs: string) => placedFrom(staged, placedAs),
        discarded: () => discardedFrom(staged),
      };
    }).pipe(Effect.onError(() => writing.abandoned()));
  });
}
