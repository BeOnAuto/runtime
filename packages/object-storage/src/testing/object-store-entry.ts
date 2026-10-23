import type { S3Client } from '@aws-sdk/client-s3';
import type { ContentEntry } from '@on.auto/operations/testing';
import { onTestFinished } from 'vitest';

import { objectContentOn } from '../content/object-content.ts';
import type { ContentLocation } from '../location/content-location.ts';
import { objectKeysOf } from '../location/object-keys.ts';
import type { S3Bucket } from '../s3/bucket-requests.ts';
import { bucketOnS3 } from '../s3/s3-bucket.ts';
import { emptied, keysIn, openUploadsIn } from './test-object-store.ts';

export interface StoreClients {
  readonly writing: () => S3Client;
  readonly reading: () => S3Client;
  readonly bucket: string;
}

export interface ObjectStoreUnderTest {
  readonly bucket: S3Bucket;
  readonly location: ContentLocation;
  readonly reading: () => S3Client;
}

export interface ObjectStoreEntry {
  readonly aStore: () => Promise<ObjectStoreUnderTest>;
}

let stores = 0;

export function objectStoreEntry(clientsOf: () => Promise<StoreClients>): ObjectStoreEntry {
  return {
    aStore: async () => {
      const { writing, reading, bucket } = await clientsOf();
      stores += 1;
      const prefix = `content-test/${String(process.pid)}-${String(Date.now())}-${String(stores)}`;
      const store = { bucket: { client: writing, name: bucket }, location: { bucket, prefix }, reading };
      onTestFinished(() => emptied(store.bucket, prefix));
      return store;
    },
  };
}

export function contentEntryOf(entry: ObjectStoreEntry): ContentEntry {
  return {
    aStore: async () => {
      const store = await entry.aStore();
      const { uploads } = objectKeysOf(store.location);
      const unnamed = async () =>
        (await keysIn(store.bucket, uploads)).length + (await openUploadsIn(store.bucket, uploads)).length;
      return {
        content: objectContentOn(bucketOnS3(store.bucket), store.location).content,
        elsewhere: objectContentOn(bucketOnS3({ client: store.reading, name: store.bucket.name }), store.location)
          .content,
        unnamedLeft: unnamed,
      };
    },
  };
}
