import { Upload } from '@aws-sdk/lib-storage';

import type { Bucket, ObjectBody, UnfinishedPut } from '../bucket/bucket.ts';
import { storageWaits, type StorageWaits } from '../client/storage-client.ts';
import {
  copied,
  heldAt,
  keysUnder,
  readAt,
  removed,
  uploadAbandoned,
  uploadsUnder,
  written,
  type S3Bucket,
} from './bucket-requests.ts';

export const uploadPartBytes = 5 * 1_048_576;

const uploadPartsAtOnce = 2;

interface StreamedObject {
  readonly stream: ReadableStream<Uint8Array>;
  readonly mediaType: string;
}

async function uploaded(
  { client, name }: S3Bucket,
  key: string,
  { stream, mediaType }: StreamedObject,
): Promise<boolean> {
  const upload = new Upload({
    client: client(),
    params: { Bucket: name, Key: key, Body: stream, ContentType: mediaType },
    partSize: uploadPartBytes,
    queueSize: uploadPartsAtOnce,
  });
  await upload.done();
  return true;
}

async function* unfinishedUnder(bucket: S3Bucket, prefix: string): AsyncGenerator<UnfinishedPut> {
  for await (const open of uploadsUnder(bucket, prefix)) {
    yield { key: open.key, abandon: () => uploadAbandoned(bucket, open) };
  }
}

function putIn(bucket: S3Bucket, key: string, body: ObjectBody): Promise<boolean> {
  if ('stream' in body) {
    return uploaded(bucket, key, body);
  }
  if ('copyOf' in body) {
    return copied(bucket, body.copyOf, key, body.ifAbsent);
  }
  return written(bucket, key, body);
}

export function bucketOnS3(bucket: S3Bucket, { requestMs }: StorageWaits = storageWaits): Bucket {
  return {
    put: (key, body) => putIn(bucket, key, body),
    get: (key) => readAt(bucket, key, requestMs),
    head: (key) => heldAt(bucket, key),
    delete: (keys) => removed(bucket, keys),
    list: (prefix) => keysUnder(bucket, prefix),
    unfinished: (prefix) => unfinishedUnder(bucket, prefix),
  };
}
