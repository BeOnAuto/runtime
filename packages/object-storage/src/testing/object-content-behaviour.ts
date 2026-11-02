import {
  keptOutside,
  notTheBytesOfItsDigest,
  sha256Of,
  type ContentStore,
  type RecordedContent,
} from '@on.auto/content';
import {
  alpha,
  defectOf,
  deliveredBeforeFailing,
  generated,
  json,
  memoryContentHeads,
  octets,
  pausableStore,
  present,
  refusalOf,
  resultOf,
} from '@on.auto/content/testing';
import { randomUUIDv7 } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { objectContentOn } from '../content/object-content.ts';
import { objectKeysOf } from '../location/object-keys.ts';
import { objectStoreReached, ObjectStoreUnreachable } from '../s3/object-store-reached.ts';
import { bucketOnS3 } from '../s3/s3-bucket.ts';
import type { ObjectStoreEntry, ObjectStoreUnderTest } from './object-store-entry.ts';
import { keysIn, multipartUploadBegun, openUploadsIn, uploadWritten } from './test-object-store.ts';

const longAgo = '00000000-0000-7000-8000-000000000001';

function contentOn(store: ObjectStoreUnderTest, objects: ContentStore = objectsOf(store)): RecordedContent {
  return keptOutside(memoryContentHeads(), objects).content;
}

function objectsOf(store: ObjectStoreUnderTest): ContentStore {
  return objectContentOn(bucketOnS3(store.bucket), store.location);
}

function keptOnObjects(entry: ObjectStoreEntry): void {
  it('keeps a content as one object under its playbook and digest, with its media type and size', async () => {
    const store = await entry.aStore();
    const keys = objectKeysOf(store.location);
    const { sha256, content: generatedContent } = await generated(2_500_000);

    await resultOf(contentOn(store).put(alpha, { ...generatedContent(), mediaType: json }));
    const kept = await keysIn(store.bucket, store.location.prefix);
    const held = await bucketOnS3(store.bucket).head(keys.kept(alpha, sha256));

    expect(kept).toEqual([`${store.location.prefix}/playbook/acme/alpha/${sha256}`]);
    expect(held).toEqual({ bytes: 2_500_000, mediaType: json });
  });

  it.each([
    ['of one chunk', 1000],
    ['of several chunks', 2_500_000],
  ])(
    'places a content %s whose head stands without its object with the media type of its head, not that of the put that places it',
    async (_size, bytes) => {
      const store = await entry.aStore();
      const paused = pausableStore(objectsOf(store));
      const content = contentOn(store, paused.store);
      const { sha256, content: generatedContent } = await generated(bytes);
      paused.pausedPlace().fail();
      await resultOf(defectOf(content.put(alpha, { ...generatedContent(), mediaType: json })));

      const kept = await resultOf(content.put(alpha, { ...generatedContent(), mediaType: octets }));

      expect(kept).toEqual({ sha256, bytes, mediaType: json });
      expect(await bucketOnS3(store.bucket).head(objectKeysOf(store.location).kept(alpha, sha256))).toEqual({
        bytes,
        mediaType: json,
      });
    },
  );
}

function removedFromObjects(entry: ObjectStoreEntry): void {
  it('removes a content by deleting the one object under its playbook and digest', async () => {
    const store = await entry.aStore();
    const objects = objectsOf(store);
    const { sha256 } = await resultOf(contentOn(store, objects).put(alpha, (await generated(2_500_000)).content()));

    await resultOf(objects.delete(alpha, sha256));

    expect(await keysIn(store.bucket, store.location.prefix)).toEqual([]);
    expect(await resultOf(objects.holds(alpha, sha256))).toBe(false);
  });
}

function misfiledRead(entry: ObjectStoreEntry): void {
  it('fails a read of an object whose bytes are not those its digest names, before it hands over the last of them', async () => {
    const store = await entry.aStore();
    const bucket = bucketOnS3(store.bucket);
    const content = contentOn(store);
    const keys = objectKeysOf(store.location);
    const { sha256 } = await resultOf(content.put(alpha, (await generated(2_500_000)).content()));
    const misfiled = sha256Of('another content');
    await bucket.put(keys.kept(alpha, misfiled), { copyOf: keys.kept(alpha, sha256), mediaType: octets });

    const delivered = await deliveredBeforeFailing((await present(content.get(alpha, misfiled))).stream);

    expect(delivered.failure).toEqual(notTheBytesOfItsDigest(misfiled));
    expect(delivered.bytes).toBeLessThan(2_500_000);
  });
}

async function uploadsBegun(store: ObjectStoreUnderTest, fresh: string): Promise<void> {
  const keys = objectKeysOf(store.location);
  await uploadWritten(store.bucket, keys.upload(longAgo));
  await uploadWritten(store.bucket, keys.upload(fresh));
  await multipartUploadBegun(store.bucket, keys.upload(longAgo));
  await multipartUploadBegun(store.bucket, keys.upload(fresh));
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
    removedFromObjects(entry);
    misfiledRead(entry);
    uploadsSwept(entry);
  });
}
