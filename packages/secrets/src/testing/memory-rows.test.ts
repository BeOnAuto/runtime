import { describe } from 'vitest';

import { rowsBehaviour } from './rows-behaviour.ts';
import { inMemoryEntry } from './secrets-entry.ts';
import { storeBehaviour } from './store-behaviour.ts';

const inMemory = inMemoryEntry();

describe('the rows kept in memory', () => {
  rowsBehaviour(inMemory);
  storeBehaviour(inMemory);
});
