import { describe } from 'vitest';

import { keptOutside } from '../content/kept-outside.ts';
import type { ContentEntry } from './content-entry.ts';
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

describe('The content kept in memory', () => {
  recordedContentBehaviour(inMemory);
});
