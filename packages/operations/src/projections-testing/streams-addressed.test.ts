import { describe, expect, it } from 'vitest';

import { streamAddressed } from './streams-addressed.ts';

describe('a stream addressed for a fold in a test', () => {
  it('answers the stream as the ledger addresses it', () => {
    expect(streamAddressed('definition/acme/d1/assets/a1')).toEqual({
      scope: 'definition',
      prefix: 'definition/acme/d1/',
      address: { org: 'acme', definition: 'd1' },
      kind: 'assets',
      id: 'a1',
    });
  });

  it('refuses a stream that lies under no key', () => {
    expect(() => streamAddressed('assets/a1')).toThrow('The stream assets/a1 lies under no key a projection folds');
  });
});
