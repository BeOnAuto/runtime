import { describe, expect, it } from 'vitest';

import { notTheBytesOfItsDigest } from './content-refusals.ts';

describe('the refusals of a content', () => {
  it('name a content a read found to be other bytes than its digest names', () => {
    expect(notTheBytesOfItsDigest('9f3e').message).toBe(
      'The content kept under 9f3e is not the bytes that digest names',
    );
  });
});
