import { describe, expect, it } from 'vitest';

import { isJsonPointer, textAt, valueAt } from './json-pointers.ts';

const answered = {
  ok: true,
  channel: 'C0123',
  ts: '1699.1',
  'a/b': { 'm~n': 'escaped' },
  messages: [{ ts: '1699.2', user: 'ada', text: 'approve' }, { ts: 1_699_000_003 }, { ts: 1.5 }],
};

describe('a JSON Pointer', () => {
  it('is empty, or a path from the root whose tildes escape a slash or a tilde', () => {
    expect(
      ['', '/ts', '/messages/0/ts', '/a~1b/m~0n', 'ts', '/ts~', '/ts~2'].map((text) => isJsonPointer(text)),
    ).toEqual([true, true, true, true, false, false, false]);
  });

  it('reads the value at its place, through objects and arrays, and nothing past them', () => {
    expect([
      valueAt(answered, ''),
      valueAt(answered, '/messages/0/user'),
      valueAt(answered, '/a~1b/m~0n'),
      valueAt(answered, '/messages/-'),
      valueAt(answered, '/messages/01'),
      valueAt(answered, '/messages/9'),
      valueAt(answered, '/ts/length'),
      valueAt(answered, '/toString'),
    ]).toEqual([answered, 'ada', 'escaped', undefined, undefined, undefined, undefined, undefined]);
  });

  it('reads text, or a whole number as text, and nothing else', () => {
    expect([
      textAt(answered, '/ts'),
      textAt(answered, '/messages/1/ts'),
      textAt(answered, '/messages/2/ts'),
      textAt(answered, '/ok'),
      textAt(answered, '/missing'),
    ]).toEqual(['1699.1', '1699000003', undefined, undefined, undefined]);
  });
});
