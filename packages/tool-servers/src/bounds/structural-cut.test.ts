import { describe, expect, it } from 'vitest';

import { cutWhereValid } from './structural-cut.ts';
import { bytesOf } from './text-bytes.ts';

function cutsOf(text: string): readonly string[] {
  return Array.from({ length: bytesOf(text) }, (_, budget) => cutWhereValid(text, budget));
}

describe('cutting a text where it stays valid', () => {
  it('keeps a text within the budget whole', () => {
    expect(cutWhereValid('{"a":1}', 7)).toBe('{"a":1}');
  });

  it('cuts JSON inside an array after its last complete element, and closes it', () => {
    expect(cutWhereValid('[1,22,333,4444]', 11)).toBe('[1,22,333]');
    expect(cutWhereValid('{"rows":[{"id":1},{"id":2}]}', 22)).toBe('{"rows":[{"id":1}]}');
  });

  it('cuts JSON inside an object after its last complete member, and never inside a key, a number or a literal', () => {
    expect(cutWhereValid('{"first":true,"second":12345}', 26)).toBe('{"first":true}');
    expect(cutWhereValid('{"a":null,"b":false}', 15)).toBe('{"a":null}');
  });

  it('cuts a string value at a code point outside an escape, and closes it', () => {
    expect(cutWhereValid('{"note":"héllo \\"wörld\\" 😀 \\u00e9 end"}', 22)).toBe('{"note":"héllo \\"w"}');
    expect(cutWhereValid('["😀😀😀"]', 10)).toBe('["😀"]');
    expect(cutWhereValid('["€€€"]', 9)).toBe('["€"]');
    expect(cutWhereValid('["a\\u00e9b"]', 9)).toBe('["a"]');
  });

  it('reads whitespace between values and keeps nothing it cannot close', () => {
    expect(cutWhereValid('{ "a" : [ 1 , 2 ] ,\n "b" : 3 }', 18)).toBe('{ "a" : [ 1 , 2 ]}');
    expect(cutWhereValid('[[[1]]]', 2)).toBe('');
  });

  it('cuts prose at a code point', () => {
    expect(cutWhereValid('héllo wörld', 6)).toBe('héllo');
    expect(cutWhereValid('a😀b', 3)).toBe('a');
  });

  it('answers valid JSON at every budget, and the same cut again for the size of a cut', () => {
    const text = JSON.stringify({ rows: [{ id: 1, name: 'zoë "the" 😀', tags: ['a', 'b'] }], more: null, n: -1.5e3 });
    const cuts = cutsOf(text);

    expect(cuts.filter((cut) => cut !== '').every((cut) => JSON.parse(cut) !== undefined)).toBe(true);
    expect(cuts.every((cut) => cutWhereValid(text, bytesOf(cut)) === cut)).toBe(true);
  });
});
