import { CreateBucketCommand } from '@aws-sdk/client-s3';

import { storageClientOf } from '../client/storage-client.ts';
import {
  bucketReached,
  keysUnder,
  removed,
  uploadAbandoned,
  uploadsUnder,
  type S3Bucket,
} from '../s3/bucket-requests.ts';

export interface TestObjectStore {
  readonly bucket: S3Bucket;
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

async function listed<A>(items: AsyncIterable<A>): Promise<readonly A[]> {
  const all: A[] = [];
  for await (const item of items) {
    all.push(item);
  }
  return all;
}

export function testObjectStoreOf(url: string): TestObjectStore {
  const { origin, username, password, pathname } = new URL(url);
  const [accessKeyId, secretAccessKey] = [decodeURIComponent(username), decodeURIComponent(password)];
  const client = storageClientOf(
    { endpoint: origin, region: 'us-east-1', proxy: { enabled: false, environment: {} } },
    { accessKeyId, secretAccessKey },
  );
  return { bucket: { client: () => client, name: pathname.slice(1) }, endpoint: origin, accessKeyId, secretAccessKey };
}

export async function bucketReady(bucket: S3Bucket): Promise<void> {
  const created = () => bucket.client().send(new CreateBucketCommand({ Bucket: bucket.name }));
  await bucketReached(bucket).catch(() => created().catch(() => bucketReached(bucket)));
}

export function keysIn(bucket: S3Bucket, prefix: string): Promise<readonly string[]> {
  return listed(keysUnder(bucket, prefix));
}

export async function openUploadsIn(bucket: S3Bucket, prefix: string): Promise<readonly string[]> {
  return (await listed(uploadsUnder(bucket, prefix))).map(({ key }) => key);
}

export async function emptied(bucket: S3Bucket, prefix: string): Promise<void> {
  const open = await listed(uploadsUnder(bucket, prefix));
  await Promise.all(open.map((upload) => uploadAbandoned(bucket, upload)));
  await removed(bucket, await keysIn(bucket, prefix));
}
