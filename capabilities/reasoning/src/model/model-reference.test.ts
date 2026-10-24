import { describe, expect, it } from 'vitest';

import { providerOf } from './model-reference.ts';

describe('the provider of a model', () => {
  it('is the part of its reference before the slash, or the reference itself when it names no provider', () => {
    expect([providerOf('anthropic/claude-sonnet-4-5'), providerOf('fast')]).toEqual(['anthropic', 'fast']);
  });
});
