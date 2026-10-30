import { verifiedStream, type ContentStore, type StreamedContent } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Bucket } from '../bucket/bucket.ts';
import type { ContentLocation } from '../location/content-location.ts';
import { objectKeysOf } from '../location/object-keys.ts';
import { stagedOn, unstagedOn } from './object-staging.ts';
import { placedOn, type Placing } from './object-writes.ts';
import { sweptUploads } from './upload-sweep.ts';

async function verifiedAt(bucket: Bucket, key: string, sha256: string): Promise<StreamedContent | undefined> {
  const read = await bucket.get(key);
  return read === undefined ? undefined : { ...read, stream: verifiedStream(sha256, read.bytes, read.stream) };
}

export function objectContentOn(bucket: Bucket, location: ContentLocation): ContentStore {
  const placing: Placing = { bucket, keys: objectKeysOf(location) };
  const { keys } = placing;
  const readOf = (key: string, sha256: string) => Effect.promise(() => verifiedAt(bucket, key, sha256));
  return {
    content: {
      put: (playbook, content) => placedOn(placing, (sha256) => keys.kept(playbook, sha256), content),
      get: (playbook, sha256) => readOf(keys.kept(playbook, sha256), sha256),
      stage: (playbook, run, content) => stagedOn(placing, { playbook, run }, content),
      staged: (playbook, run, sha256) => readOf(keys.staged(playbook, run, sha256), sha256),
      unstage: (playbook, run) => Effect.promise(() => unstagedOn(placing, { playbook, run })),
    },
    sweepContent: (before) => sweptUploads(bucket, keys.uploads, before),
  };
}
