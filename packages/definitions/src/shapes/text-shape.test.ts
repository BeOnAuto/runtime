import { describe, expect, it } from 'vitest';

import { shapeNamed } from '../testing/index.ts';

const { check } = shapeNamed('text');

describe('a text', () => {
  it('is Markdown of at most 65,536 bytes as UTF-8', () => {
    expect([check({ text: '' }), check({ text: 'x'.repeat(65_536) }), check({ text: 'é'.repeat(32_768) })]).toEqual([
      [],
      [],
      [],
    ]);
    expect(check({ text: 'é'.repeat(32_769) })).toEqual([
      { pointer: '/text', detail: 'Expected at most 65,536 bytes as UTF-8' },
    ]);
    expect(check({ text: 'x'.repeat(65_537) })).toEqual([
      { pointer: '/text', detail: 'Expected a string with at most 65536 code points' },
      { pointer: '/text', detail: 'Expected at most 65,536 bytes as UTF-8' },
    ]);
  });

  it('is its one field, which it needs', () => {
    expect([check({}), check({ text: 1 }), check({ text: 'a', title: 'b' })]).toEqual([
      [{ pointer: '/text', detail: 'Missing key' }],
      [{ pointer: '/text', detail: 'Expected string' }],
      [{ pointer: '/title', detail: 'Expected no excess property' }],
    ]);
  });
});
