import { describe, expect, it } from 'vitest';

import { keptOutside } from '../content/kept-outside.ts';
import type { ContentEntry, ExpiringContentEntry, InterleavedErasureEntry } from './content-entry.ts';
import { alpha, resultOf } from './content-samples.ts';
import { expiringContentBehaviour } from './expiring-content-behaviour.ts';
import { interleavedErasureBehaviour } from './interleaved-erasure-behaviour.ts';
import { memoryContentHeads, memoryContentStore } from './memory-content.ts';
import { recordedContentBehaviour } from './recorded-content-behaviour.ts';

const inMemory: ContentEntry = {
  aStore: async () => {
    const store = memoryContentStore();
    await store.sweepContent(0);
    const { content } = keptOutside(memoryContentHeads(), store);
    return { content, elsewhere: content, unnamedLeft: () => Promise.resolve(0) };
  },
};

const expiringInMemory: ExpiringContentEntry = {
  aStore: () => {
    const store = memoryContentStore();
    const { content, eraseExpired } = keptOutside(memoryContentHeads(), store);
    const keeping = { content, eraseExpired };
    return Promise.resolve({
      ...keeping,
      elsewhere: keeping,
      bytesHeld: (playbook, sha256) => resultOf(store.holds(memoryContentHeads().placeOfNewBytes(playbook), sha256)),
    });
  },
};

const erasedInMemory: InterleavedErasureEntry = {
  aStore: () => Promise.resolve(memoryContentStore()),
  aKeeping: (store) => {
    const keeping = keptOutside(memoryContentHeads(), store);
    return Promise.resolve({ ...keeping, elsewhere: keeping });
  },
  placeOf: memoryContentHeads().placeOfNewBytes,
};

describe('The content kept in memory', () => {
  recordedContentBehaviour(inMemory);
  expiringContentBehaviour(expiringInMemory);
  interleavedErasureBehaviour(erasedInMemory);
  it('reads nothing, whole or in part, at a place that holds no bytes of the digest', async () => {
    const store = memoryContentStore();
    const place = memoryContentHeads().placeOfNewBytes(alpha);
    const digest = '0'.repeat(64);

    const read = [
      await resultOf(store.read(place, digest)),
      await resultOf(store.readPart(place, digest, { start: 0, end: 1 })),
    ];

    expect(read).toEqual([undefined, undefined]);
  });
});
