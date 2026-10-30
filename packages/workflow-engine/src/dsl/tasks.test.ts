import { describe, expect, it } from 'vitest';

import { entryAt, kindOf, pointerTo, taskEntries } from './tasks.ts';

describe('the tasks of a list', () => {
  it('are named entries with a JSON pointer reference into the document', () => {
    expect(taskEntries([{ greet: { set: { a: 1 } } }, { 'odd/name~': { wait: 'PT1S' } }], '/do')).toEqual([
      { name: 'greet', task: { set: { a: 1 } }, reference: '/do/0/greet' },
      { name: 'odd/name~', task: { wait: 'PT1S' }, reference: '/do/1/odd~1name~0' },
    ]);
  });

  it('leave out what is not a named task, and a list that is not one', () => {
    expect(taskEntries([1, { named: 'not a task' }], '/do')).toEqual([]);
    expect(taskEntries({ not: 'a list' }, '/do')).toEqual([]);
    expect(taskEntries(undefined, '/do')).toEqual([]);
  });
});

describe('the kind of a task', () => {
  it('is its first field that names a task type, a for before its do', () => {
    expect(kindOf({ for: { in: '.x' }, do: [] })).toBe('for');
    expect(kindOf({ do: [] })).toBe('do');
    expect(kindOf({ try: [], catch: {} })).toBe('try');
    expect(kindOf({ dance: true })).toBeUndefined();
  });

  it('extends a JSON pointer with escaped segments', () => {
    expect(pointerTo('/do', 0)).toBe('/do/0');
    expect(pointerTo('', 'a/b~c')).toBe('/a~1b~0c');
  });
});

describe('the task at a reference', () => {
  it('is named by the last segment of its reference, unescaped, and is an empty task where none is', () => {
    const document = { do: [{ 'a/b': { set: {} } }] };

    expect(entryAt(document, '/do/0/a~1b')).toEqual({ name: 'a/b', task: { set: {} }, reference: '/do/0/a~1b' });
    expect(entryAt(document, '/do/1/missing')).toEqual({ name: 'missing', task: {}, reference: '/do/1/missing' });
  });
});
