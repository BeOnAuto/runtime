import { describe, expect, it } from 'vitest';

import { applyStatePatch, PatchFailed } from '../index.ts';

const state = {
  machine: { context: 0, values: { '0': { value: 1 } } },
  list: ['a', 'b'],
  rows: [{ name: 'a' }],
  'a/b': { '~': 1 },
};

describe('a state patch', () => {
  it('adds, replaces and removes members of objects and lists, by JSON Pointer, without changing the state it was given', () => {
    const patched = applyStatePatch(state, [
      { op: 'add', path: '/machine/values/1', value: { value: 2 } },
      { op: 'replace', path: '/machine/context', value: 1 },
      { op: 'add', path: '/list/1', value: 'between' },
      { op: 'add', path: '/list/-', value: 'last' },
      { op: 'remove', path: '/list/0' },
      { op: 'replace', path: '/list/2', value: 'z' },
      { op: 'replace', path: '/a~1b/~0', value: 2 },
      { op: 'replace', path: '/rows/0/name', value: 'b' },
      { op: 'remove', path: '/machine/values/0' },
    ]);

    expect(patched).toEqual({
      machine: { context: 1, values: { '1': { value: 2 } } },
      list: ['between', 'b', 'z'],
      rows: [{ name: 'b' }],
      'a/b': { '~': 2 },
    });
    expect(state.list).toEqual(['a', 'b']);
  });

  it.each([
    [{ op: 'replace', path: '/machine/missing', value: 1 }, 'The state has no member missing'],
    [{ op: 'remove', path: '/list/2' }, 'The state has no member 2'],
    [{ op: 'add', path: '/machine/context', value: 1 }, 'The member context is there already'],
    [{ op: 'add', path: '/list/3', value: 'x' }, 'The list has no position 3'],
    [{ op: 'add', path: '/list/one', value: 'x' }, 'The list has no position one'],
    [{ op: 'replace', path: '/gone/deeper', value: 1 }, 'The state has no member gone on the way'],
    [
      { op: 'replace', path: '/machine/context/deeper', value: 1 },
      'The path goes through a value that is neither an object nor a list',
    ],
    [{ op: 'replace', path: '', value: {} }, 'A path names a member under the root, such as /machine/context'],
    [{ op: 'remove', path: 'machine' }, 'A path names a member under the root, such as /machine/context'],
  ] as const)('fails at once, never guessing, on %j', (operation, detail) => {
    expect(() => applyStatePatch(state, [operation])).toThrow(new PatchFailed({ ...operation, detail }));
  });
});
