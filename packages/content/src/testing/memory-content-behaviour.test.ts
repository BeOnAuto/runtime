import { describe } from 'vitest';

import { keptOutside } from '../content/kept-outside.ts';
import type { ContentEntry, ExpiringContentEntry, InterleavedErasureEntry } from './content-entry.ts';
import { resultOf } from './content-samples.ts';
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
      bytesHeld: (playbook, sha256) => resultOf(store.holds(playbook, sha256)),
    });
  },
};

const erasedInMemory: InterleavedErasureEntry = {
  aStore: () => Promise.resolve(memoryContentStore()),
  aKeeping: (store) => {
    const keeping = keptOutside(memoryContentHeads(), store);
    return Promise.resolve({ ...keeping, elsewhere: keeping });
  },
};

describe('The content kept in memory', () => {
  recordedContentBehaviour(inMemory);
  expiringContentBehaviour(expiringInMemory);
  interleavedErasureBehaviour(erasedInMemory);
});
