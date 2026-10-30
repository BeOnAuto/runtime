import { recordedContentBehaviour } from '@on.auto/operations/testing';
import { describe, expect, it, vi } from 'vitest';

import { objectContentBehaviour } from '../testing/object-content-behaviour.ts';
import { contentEntryOf, objectStoreEntry } from '../testing/object-store-entry.ts';
import { bucketReady, testObjectStoreOf } from '../testing/test-object-store.ts';

const server = process.env['CONTENT_TEST_OBJECT_STORE_URL'] ?? '';

const onTheServer = objectStoreEntry(async () => {
  const [writing, reading] = [testObjectStoreOf(server), testObjectStoreOf(server)];
  await bucketReady(writing.bucket);
  return { writing: writing.bucket.client, reading: reading.bucket.client, bucket: writing.bucket.name };
});

const skipped = server === '';

const notice = skipped
  ? ', skipped: set CONTENT_TEST_OBJECT_STORE_URL to the URL of an S3-compatible server with its credentials and a bucket, such as http://access:secret@127.0.0.1:9000/content-test, to run it'
  : '';

describe.skipIf(skipped)(`The content kept on an S3-compatible object store${notice}`, { timeout: 120_000 }, () => {
  const warned = vi.spyOn(console, 'warn');
  recordedContentBehaviour(contentEntryOf(onTheServer));
  objectContentBehaviour(onTheServer);
  it('writes nothing to console.warn from the SDK while it keeps, reads, stages and sweeps', () => {
    expect(warned).not.toHaveBeenCalled();
  });
});
