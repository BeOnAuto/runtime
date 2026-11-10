import { describe, expect, it } from 'vitest';

import { notTheBytesOfItsDigest, notTheBytesOfItsPart } from './content-refusals.ts';
import { NotTheBytesKept } from './not-the-bytes-kept.ts';

describe('the refusals of a content', () => {
  it('name a content a read found to be other bytes than its digest names', () => {
    expect(notTheBytesOfItsDigest('9f3e').message).toBe(
      'The content kept under 9f3e is not the bytes that digest names',
    );
  });

  it('are failures a reader tells apart from a read that failed on its way, whole or in part', () => {
    expect(notTheBytesOfItsDigest('9f3e')).toBeInstanceOf(NotTheBytesKept);
    expect(notTheBytesOfItsPart('9f3e', 12)).toBeInstanceOf(NotTheBytesKept);
    expect(new TypeError('terminated')).not.toBeInstanceOf(NotTheBytesKept);
  });
});
