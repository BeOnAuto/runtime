import { describe, expect, it } from 'vitest';

import { noPayloadCache, payloadCacheWithin } from './payload-cache.ts';

const [alpha, beta] = [
  { org: 'acme', playbook: 'alpha' },
  { org: 'acme', playbook: 'beta' },
];

const [first, second, third] = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];

describe('the texts of payloads kept in memory', () => {
  it('answer a text by its playbook and its digest, so a playbook never reads one only another keeps', () => {
    const cache = payloadCacheWithin(100);

    cache.kept(alpha, first, 'alpha text');

    expect([cache.textOf(alpha, first), cache.textOf(beta, first), cache.textOf(alpha, second)]).toEqual([
      'alpha text',
      undefined,
      undefined,
    ]);
  });

  it('let go of the least recently read or kept first once their bytes, two a UTF-16 code unit, pass the bound, and never keep a text past the bound', () => {
    const cache = payloadCacheWithin(20);
    cache.kept(alpha, first, 'aaaa');
    cache.kept(alpha, second, 'bbbb');
    cache.textOf(alpha, first);

    cache.kept(alpha, third, 'cccc');
    cache.kept(alpha, third, 'cccc');
    cache.kept(beta, first, 'é'.repeat(11));

    expect([
      cache.textOf(alpha, first),
      cache.textOf(alpha, second),
      cache.textOf(alpha, third),
      cache.textOf(beta, first),
    ]).toEqual(['aaaa', undefined, 'cccc', undefined]);
  });

  it('count a text kept again as kept last, so it outlasts one read before it', () => {
    const cache = payloadCacheWithin(16);
    cache.kept(alpha, first, 'aaaa');
    cache.kept(alpha, second, 'bbbb');

    cache.kept(alpha, first, 'aaaa');
    cache.kept(alpha, third, 'cccc');

    expect([cache.textOf(alpha, first), cache.textOf(alpha, second), cache.textOf(alpha, third)]).toEqual([
      'aaaa',
      undefined,
      'cccc',
    ]);
  });
});

describe('the texts of payloads where a shell keeps none', () => {
  it('are never kept', () => {
    noPayloadCache.kept(alpha, first, 'text');

    expect(noPayloadCache.textOf(alpha, first)).toBeUndefined();
  });
});
