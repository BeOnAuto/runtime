import { describe, expect, it } from 'vitest';

import { addedUsage, unknownUsage, type TokenUsage } from './model-result.ts';

const counted: TokenUsage = {
  input: { total: 100, uncached: 10, cache_read: 90, cache_write: null },
  output: { total: 40, text: 30, reasoning: null },
  total: 140,
};

describe('the usage of the model calls of a run, added up', () => {
  it('adds what each call counted, counts what one call did not count as nothing, and is unknown where no call counted', () => {
    expect(addedUsage(addedUsage(unknownUsage, counted), counted)).toEqual({
      input: { total: 200, uncached: 20, cache_read: 180, cache_write: null },
      output: { total: 80, text: 60, reasoning: null },
      total: 280,
    });
    expect(addedUsage(counted, unknownUsage)).toEqual(counted);
  });
});
