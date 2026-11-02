import { verifiedStream, type ContentStore, type StreamedContent } from '@on.auto/content';
import { Effect } from 'effect';

import type { Bucket } from '../bucket/bucket.ts';
import type { ContentLocation } from '../location/content-location.ts';
import { objectKeysOf } from '../location/object-keys.ts';
import { stagedOn, type Placing } from './object-writes.ts';
import { sweptUploads } from './upload-sweep.ts';

async function verifiedAt(bucket: Bucket, key: string, sha256: string): Promise<StreamedContent | undefined> {
  const read = await bucket.get(key);
  return read === undefined ? undefined : { ...read, stream: verifiedStream(sha256, read.bytes, read.stream) };
}

export function objectContentOn(bucket: Bucket, location: ContentLocation): ContentStore {
  const placing: Placing = { bucket, keys: objectKeysOf(location) };
  const { keys } = placing;
  return {
    stage: (playbook, content) => stagedOn(placing, playbook, content),
    holds: (playbook, sha256) =>
      Effect.promise(async () => (await bucket.head(keys.kept(playbook, sha256))) !== undefined),
    read: (playbook, sha256) => Effect.promise(() => verifiedAt(bucket, keys.kept(playbook, sha256), sha256)),
    delete: (playbook, sha256) => Effect.promise(() => bucket.delete([keys.kept(playbook, sha256)])),
    sweepContent: (before) => sweptUploads(bucket, keys.uploads, before),
  };
}
