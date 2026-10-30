import { recordedContentBehaviour } from '@on.auto/operations/testing';
import { describe } from 'vitest';

import { fakeBucket, type FakeBucketOptions } from '../testing/fake-bucket.ts';
import { objectContentBehaviour } from '../testing/object-content-behaviour.ts';
import { contentEntryOf, objectStoreEntry } from '../testing/object-store-entry.ts';

function onAFakeBucket(options: FakeBucketOptions) {
  return objectStoreEntry(() => {
    const bucket = fakeBucket(options);
    const [writing, reading] = [bucket.client(), bucket.client()];
    return Promise.resolve({ writing: () => writing, reading: () => reading, bucket: 'content' });
  });
}

const stores: readonly (readonly [string, FakeBucketOptions])[] = [
  ['that honours a conditional copy', { pageSize: 2 }],
  ['that ignores a conditional copy', { pageSize: 2, honoursConditionalCopy: false }],
];

describe.each(stores)('The content kept on a fake object store %s', (_store, options) => {
  recordedContentBehaviour(contentEntryOf(onAFakeBucket(options)));
  objectContentBehaviour(onAFakeBucket(options));
});
