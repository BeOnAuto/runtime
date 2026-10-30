import { CreateMultipartUploadCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { notTheBytesOfItsDigest, randomUUIDv7, sha256Of } from '@on.auto/operations';
import {
  alpha,
  deliveredBeforeFailing,
  generated,
  json,
  present,
  refusalOf,
  resultOf,
} from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { objectContentOn } from '../content/object-content.ts';
import { objectKeysOf } from '../location/object-keys.ts';
import { objectStoreReached, ObjectStoreUnreachable } from '../s3/object-store-reached.ts';
import { bucketOnS3 } from '../s3/s3-bucket.ts';
import type { ObjectStoreEntry, ObjectStoreUnderTest } from './object-store-entry.ts';
import { keysIn, openUploadsIn } from './test-object-store.ts';

const longAgo = '00000000-0000-7000-8000-000000000001';

function keptOnObjects(entry: ObjectStoreEntry): void {
  it('keeps a content as one object under its playbook and digest, with its media type and size', async () => {
    const store = await entry.aStore();
    const bucket = bucketOnS3(store.bucket);
    const { content } = objectContentOn(bucket, store.location);
    const keys = objectKeysOf(store.location);
    const { sha256, content: generatedContent } = await generated(2_500_000);

    await resultOf(content.put(alpha, { ...generatedContent(), mediaType: json }));
    const kept = await keysIn(store.bucket, store.location.prefix);
    const held = await bucket.head(keys.kept(alpha, sha256));

    expect(kept).toEqual([`${store.location.prefix}/playbook/acme/alpha/${sha256}`]);
    expect(held).toEqual({ bytes: 2_500_000, mediaType: json });
  });
}

function misfiledRead(entry: ObjectStoreEntry): void {
  it('fails a read of an object whose bytes are not those its digest names, before it hands over the last of them', async () => {
    const store = await entry.aStore();
    const bucket = bucketOnS3(store.bucket);
    const { content } = objectContentOn(bucket, store.location);
    const keys = objectKeysOf(store.location);
    const { sha256 } = await resultOf(content.put(alpha, (await generated(2_500_000)).content()));
    const misfiled = sha256Of('another content');
    await bucket.put(keys.kept(alpha, misfiled), { copyOf: keys.kept(alpha, sha256) });

    const delivered = await deliveredBeforeFailing((await present(content.get(alpha, misfiled))).stream);

    expect(delivered.failure).toEqual(notTheBytesOfItsDigest(misfiled));
    expect(delivered.bytes).toBeLessThan(2_500_000);
  });
}

async function uploadsBegun(store: ObjectStoreUnderTest, fresh: string): Promise<void> {
  const keys = objectKeysOf(store.location);
  const { client, name } = store.bucket;
  const uploaded = (uploadId: string) =>
    client().send(new PutObjectCommand({ Bucket: name, Key: keys.upload(uploadId), Body: new Uint8Array(8) }));
  const begun = (uploadId: string) =>
    client().send(new CreateMultipartUploadCommand({ Bucket: name, Key: keys.upload(uploadId) }));
  await uploaded(longAgo);
  await uploaded(fresh);
  await begun(longAgo);
  await begun(fresh);
}

function uploadsSwept(entry: ObjectStoreEntry): void {
  it('sweeps the uploads and the open multipart uploads begun before the time it is given, and keeps those begun after it', async () => {
    const store = await entry.aStore();
    const { sweepContent } = objectContentOn(bucketOnS3(store.bucket), store.location);
    const keys = objectKeysOf(store.location);
    const fresh = randomUUIDv7();
    await uploadsBegun(store, fresh);

    await sweepContent(Date.now() - 60_000);

    expect(await keysIn(store.bucket, keys.uploads)).toEqual([keys.upload(fresh)]);
    expect(await openUploadsIn(store.bucket, keys.uploads)).toEqual([keys.upload(fresh)]);
  });
}

function bucketChecked(entry: ObjectStoreEntry): void {
  it('reaches the bucket it keeps content in, and is refused a bucket that does not exist, with the answer of the store', async () => {
    const store = await entry.aStore();
    const missing = `missing-${randomUUIDv7()}`;

    const refused = await refusalOf(objectStoreReached(store.bucket.client, { bucket: missing, prefix: '' }));

    await expect(resultOf(objectStoreReached(store.bucket.client, store.location))).resolves.toBeUndefined();
    expect(refused).toEqual(new ObjectStoreUnreachable({ bucket: missing, answer: 'NotFound (404)' }));
  });
}

export function objectContentBehaviour(entry: ObjectStoreEntry): void {
  describe('the content kept on objects', () => {
    bucketChecked(entry);
    keptOnObjects(entry);
    misfiledRead(entry);
    uploadsSwept(entry);
  });
}
