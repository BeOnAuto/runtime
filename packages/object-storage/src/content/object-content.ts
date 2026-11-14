import {
  bytesIn,
  measuredStream,
  rangeWithin,
  streamedPartOf,
  verifiedStream,
  type AskedRange,
  type ContentPart,
  type ContentStore,
  type StreamedContent,
} from '@on.auto/content';
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

async function partAt(
  bucket: Bucket,
  key: string,
  sha256: string,
  asked: AskedRange,
): Promise<ContentPart | undefined> {
  const head = await bucket.head(key);
  if (head === undefined) {
    return undefined;
  }
  const whole = { size: head.bytes, mediaType: head.mediaType };
  const range = rangeWithin(asked, head.bytes);
  if (range === undefined) {
    return { ...whole, part: undefined };
  }
  const read = await bucket.getPart(key, range);
  return read === undefined
    ? undefined
    : { ...whole, part: streamedPartOf(range, measuredStream(sha256, bytesIn(range), read.stream)) };
}

export function objectContentOn(bucket: Bucket, location: ContentLocation): ContentStore {
  const placing: Placing = { bucket, keys: objectKeysOf(location) };
  const { keys } = placing;
  return {
    stage: (place, content) => stagedOn(placing, place, content),
    holds: (place, sha256) => Effect.promise(async () => (await bucket.head(keys.kept(place, sha256))) !== undefined),
    read: (place, sha256) => Effect.promise(() => verifiedAt(bucket, keys.kept(place, sha256), sha256)),
    readPart: (place, sha256, asked) => Effect.promise(() => partAt(bucket, keys.kept(place, sha256), sha256, asked)),
    delete: (place, sha256) => Effect.promise(() => bucket.delete([keys.kept(place, sha256)])),
    sweepContent: (before) => sweptUploads(bucket, keys.uploads, before),
  };
}
