import { describe, expect, it } from 'vitest';

import { modelOfferedBy } from './import-ports.ts';

describe('the models an import finds offered', () => {
  it('are those of a configured provider and the aliases, and never a reference that names no provider', () => {
    const offers = modelOfferedBy({ providers: ['anthropic'], aliases: ['fast'] });

    expect(
      ['anthropic/claude-sonnet-4-5', 'fast', 'openai/gpt-5', 'no-provider'].map((model) => offers(model)),
    ).toEqual([true, true, false, false]);
  });
});
