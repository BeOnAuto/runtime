import { describe } from 'vitest';

import { memoryRecordedContent } from '../content/memory-content.ts';
import type { ContentEntry } from './content-entry.ts';
import { recordedContentBehaviour } from './recorded-content-behaviour.ts';

const inMemory: ContentEntry = {
  aStore: () => {
    const content = memoryRecordedContent();
    return Promise.resolve({ content, elsewhere: content, unnamedLeft: () => Promise.resolve(0) });
  },
};

describe('The content kept in memory', () => {
  recordedContentBehaviour(inMemory);
});
