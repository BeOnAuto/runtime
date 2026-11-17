import { recordedContentBehaviour } from '@on.auto/content/testing';
import { interleavedRemovalBehaviour, unheldContentBehaviour } from '@on.auto/operations/testing';
import { describe } from 'vitest';

import { fakeBucket, type FakeBucketOptions } from '../testing/fake-bucket.ts';
import { objectContentBehaviour } from '../testing/object-content-behaviour.ts';
import { inMemory, interleavedEntryOf, unheldEntryOf } from '../testing/object-ledgers.ts';
import { contentEntryOf, objectStoreEntry } from '../testing/object-store-entry.ts';

function onAFakeBucket(options: FakeBucketOptions) {
  return objectStoreEntry(() => {
    const bucket = fakeBucket(options);
    const [writing, reading] = [bucket.client(), bucket.client()];
    return Promise.resolve({ writing: () => writing, reading: () => reading, bucket: 'content' });
  });
}

const stores: readonly (readonly [string, FakeBucketOptions, number])[] = [
  ['that honours a conditional copy', { pageSize: 2 }, Number.POSITIVE_INFINITY],
  ['that ignores a conditional copy', { pageSize: 2, honoursConditionalCopy: false }, 5_000_000],
];

describe.each(stores)('The content kept on a fake object store %s', (_store, options, mostBytesKeptWhole) => {
  recordedContentBehaviour({ ...contentEntryOf(onAFakeBucket(options)), mostBytesKeptWhole });
  objectContentBehaviour(onAFakeBucket(options));
});

describe('The content a ledger in memory keeps on a fake object store', () => {
  unheldContentBehaviour(unheldEntryOf(onAFakeBucket({ pageSize: 2 }), inMemory));
  interleavedRemovalBehaviour(interleavedEntryOf(onAFakeBucket({ pageSize: 2 }), inMemory));
});
