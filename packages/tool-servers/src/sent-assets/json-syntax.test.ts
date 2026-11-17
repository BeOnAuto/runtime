import { describe, expect, it } from 'vitest';

import { jsonSyntaxCheck, type JsonFound } from './json-syntax.ts';

function foundIn(pieces: readonly string[], mostDepth = 512): JsonFound {
  const check = jsonSyntaxCheck(mostDepth);
  for (const piece of pieces) {
    check.take(piece);
  }
  return check.ended();
}

const everyKind = ' {"a": [1, -2.5e+3, 0, 0.25, 1E9, -0, true, false, null], "b": {"c": "\\u00e9\\n\\"\\\\\\/"}}\n';

function cutsOf(text: string): readonly (readonly string[])[] {
  return Array.from({ length: text.length + 1 }, (_, at) => [text.slice(0, at), text.slice(at)]);
}

const values = [
  '{}',
  '[]',
  everyKind,
  '"text"',
  '0',
  '-7',
  '12.5e-3',
  'true',
  'null',
  '[[], {}, [{}]]',
  '{"": ""}',
  '[0.5, 1.5e5, 2e5, -0.5, 1e-5]',
  '{"a": 1e5, "b": 0.5}',
  '[1e10, 2E+12]',
];

const notValues = [
  '',
  '   ',
  '{',
  '[1,]',
  '{"a" 1}',
  '{"a": 1,}',
  '{a: 1}',
  '[1 2]',
  '01',
  '-',
  '1.',
  '.5',
  '1e',
  '1e+',
  '+1',
  'tru',
  'nul',
  'falsey',
  '"open',
  '"\\x"',
  '"\\u12g4"',
  '"line\nbreak"',
  '{} {}',
  '[1]]',
  '{"a": 1]',
  '[1}',
  '}',
  ']',
  '"a" : 1',
  '\uFEFF{}',
  '{"a":1},',
  'NaN',
  'trux',
  'nulL',
  '[-a]',
  '[0.5x]',
  '[1.5e]',
  '[1e+]',
  '[-]',
  '[1.]',
  '[1ex]',
];

describe('the check that an asset holds one JSON value', () => {
  it.each(values)('takes %j', (text) => {
    expect(foundIn([text])).toBe('one_value');
  });

  it.each(notValues)('refuses %j', (text) => {
    expect(foundIn([text])).toBe('not_one_value');
  });

  it('reads the same whatever the pieces it is given are cut at', () => {
    expect(cutsOf(everyKind).every((pieces: readonly string[]) => foundIn(pieces) === 'one_value')).toBe(true);
    expect([foundIn(['[1', '2', ']']), foundIn(['12', '.', '5'])]).toEqual(['one_value', 'one_value']);
  });

  it('says a value nests deeper than it may, whatever follows, and takes one exactly as deep', () => {
    expect([
      foundIn(['[[[1]]]'], 3),
      foundIn(['[[[[1]]]]'], 3),
      foundIn(['[[[[1'], 3),
      foundIn(['{"a":{"b":{}}}'], 3),
    ]).toEqual(['one_value', 'too_deep', 'too_deep', 'one_value']);
  });
});
