import { describe, expect, it } from 'vitest';

import { boundedCacheOf } from './bounded-cache.ts';

describe('a bounded cache', () => {
  it('keeps entries while their keys fit in the characters it may hold', () => {
    const cache = boundedCacheOf<number>(10);
    cache.set('aaaa', 1);
    cache.set('bbbb', 2);

    expect([cache.get('aaaa'), cache.get('bbbb'), cache.characters()]).toEqual([1, 2, 8]);
  });

  it('forgets the entry used longest ago to make room, so a read keeps an entry', () => {
    const cache = boundedCacheOf<number>(10);
    cache.set('aaaa', 1);
    cache.set('bbbb', 2);
    cache.get('aaaa');
    cache.set('cccc', 3);

    expect([cache.get('aaaa'), cache.get('bbbb'), cache.get('cccc'), cache.characters()]).toEqual([1, undefined, 3, 8]);
  });

  it('counts a key set again once, and keeps nothing whose key alone is larger than all it may hold', () => {
    const cache = boundedCacheOf<number>(10);
    cache.set('aaaa', 1);
    cache.set('aaaa', 2);
    cache.set('x'.repeat(11), 3);

    expect([cache.get('aaaa'), cache.get('x'.repeat(11)), cache.characters()]).toEqual([2, undefined, 4]);
  });
});
