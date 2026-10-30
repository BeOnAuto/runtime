import { describe, expect, it } from 'vitest';

import {
  entriesOf,
  field,
  isJson,
  isList,
  isObject,
  isTruthy,
  itemAt,
  jsonBytesOf,
  jsonEquals,
  listField,
  measureOf,
  objectField,
  textField,
  valueAtPointer,
  withinBytes,
  type Json,
} from './json.ts';

function nested(depth: number): Json {
  return depth === 0 ? 0 : [nested(depth - 1)];
}

describe('reading JSON', () => {
  const value = { name: 'Ada', tags: ['a'], nested: { deep: true }, nothing: null };

  it('reads own fields only, by kind', () => {
    expect(field(value, 'name')).toBe('Ada');
    expect(field(value, 'toString')).toBeUndefined();
    expect(textField(value, 'name')).toBe('Ada');
    expect(textField(value, 'tags')).toBeUndefined();
    expect(objectField(value, 'nested')).toEqual({ deep: true });
    expect(objectField(value, 'nothing')).toBeUndefined();
    expect(listField(value, 'tags')).toEqual(['a']);
    expect(listField(value, 'name')).toBeUndefined();
    expect(entriesOf({ a: 1 })).toEqual([['a', 1]]);
  });

  it('tells objects from lists and null', () => {
    expect([isObject({}), isObject([]), isObject(null)]).toEqual([true, false, false]);
    expect([isList([]), isList({})]).toEqual([true, false]);
  });

  it('treats only null and false as false', () => {
    expect([null, false, 0, '', true, [], {}].map((item) => isTruthy(item))).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('comparing JSON', () => {
  it('compares lists item by item and objects key by key, in any key order', () => {
    expect(jsonEquals([1, { a: 2 }], [1, { a: 2 }])).toBe(true);
    expect(jsonEquals([1, 2], [1])).toBe(false);
    expect(jsonEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEquals({ a: 1 }, { b: 1 })).toBe(false);
    expect(jsonEquals([1], { 0: 1 })).toBe(false);
    expect(jsonEquals('x', 'x')).toBe(true);
  });

  it('counts the bytes of JSON in UTF-8', () => {
    expect(jsonBytesOf({ name: 'é' })).toBe(13);
  });

  it('takes the longest start of a text whose UTF-8 is within a number of bytes, never cutting a character', () => {
    expect([withinBytes('abc', 2), withinBytes('aé', 2), withinBytes('aé', 3), withinBytes('a😀b', 4)]).toEqual([
      'ab',
      'a',
      'aé',
      'a',
    ]);
  });
});

describe('recognizing JSON', () => {
  it.each([null, 'a', true, 1.5, [1, [2]], { a: { b: null } }, Object.create(null)])('accepts %j', (value) => {
    expect(isJson(value)).toBe(true);
  });

  it('rejects numbers JSON cannot carry, and values that are not data', () => {
    expect(isJson(Number.NaN)).toBe(false);
    expect(isJson(Infinity)).toBe(false);
    expect(isJson([1, Number.NaN])).toBe(false);
    expect(isJson({ a: Number.NaN })).toBe(false);
    expect(isJson(new Date(0))).toBe(false);
    expect(isJson(Symbol('s'))).toBe(false);
  });
});

describe('the depth of JSON', () => {
  it('is at most 512 levels, past which a value is not taken for JSON', () => {
    expect(isJson(nested(512))).toBe(true);
    expect(isJson(nested(513))).toBe(false);
    expect(isJson({ a: nested(512) })).toBe(false);
  });
});

describe('measuring JSON', () => {
  it('counts the work of visiting a value: sixteen per value, plus every string and key', () => {
    expect(measureOf('abc')).toStrictEqual({ work: 19, depth: 0 });
    expect(measureOf({ ab: [true, null] })).toStrictEqual({ work: 66, depth: 2 });
  });

  it('counts a shared value as often as it occurs, and remembers what it measured', () => {
    const shared = ['x'];
    const twice = [shared, shared];

    expect(measureOf(twice)).toStrictEqual({ work: 82, depth: 2 });
    expect(measureOf([twice, twice])).toStrictEqual({ work: 180, depth: 3 });
  });

  it('measures nothing that is not JSON or nests more than 512 levels deep', () => {
    expect(measureOf(Number.NaN)).toBeUndefined();
    expect(measureOf([1, Infinity])).toBeUndefined();
    expect(measureOf(new Date(0))).toBeUndefined();
    expect(measureOf(nested(513))).toBeUndefined();
    expect(measureOf(nested(512))).toStrictEqual({ work: 16 * 513, depth: 512 });
  });

  it('measures a value it measured before only where it still fits', () => {
    const deep = nested(511);

    expect(measureOf(deep)).toStrictEqual({ work: 16 * 512, depth: 511 });
    expect(measureOf([[deep]])).toBeUndefined();
  });
});

describe('a value by its position', () => {
  const document = { do: [{ 'a/b': { set: { x: [1, 2] } } }], 'odd~key': 3 };

  it('is the item of a list at an index, and nothing for what is not a list', () => {
    expect(itemAt([4, 5], 1)).toBe(5);
    expect(itemAt([4, 5], 2)).toBeUndefined();
    expect(itemAt({ 1: 5 }, 1)).toBeUndefined();
  });

  it('is found by a JSON pointer through objects and lists, with escaped segments', () => {
    expect(valueAtPointer(document, '/do/0/a~1b/set/x/1')).toBe(2);
    expect(valueAtPointer(document, '/odd~0key')).toBe(3);
    expect(valueAtPointer(document, '')).toBe(document);
  });

  it('is nothing where the pointer goes through a value that is neither', () => {
    expect(valueAtPointer(document, '/odd~0key/deeper')).toBeUndefined();
    expect(valueAtPointer(document, '/missing/deeper')).toBeUndefined();
  });
});
