import { describe, expect, it } from 'vitest';

import { googleCredentialChain } from './vertex-providers.ts';

describe('the default credential chains', () => {
  it('are built without looking anything up', () => {
    expect(typeof googleCredentialChain('acme-ai')).toBe('function');
  });
});
