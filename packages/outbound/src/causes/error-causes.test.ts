import { describe, expect, it } from 'vitest';

import { causesOf, codesOf } from '../index.ts';

function failedWith(...codes: readonly (string | undefined)[]): unknown {
  return codes.reduceRight<unknown>(
    (cause, code) => Object.assign(new Error('fetch failed'), code === undefined ? { cause } : { code, cause }),
    null,
  );
}

describe('the causes of a failure', () => {
  it('are the failure and the causes it wraps, eight at most, ending at one that is no object', () => {
    const failure = failedWith('ECONNRESET', 'ECONNREFUSED');

    expect(causesOf(failure)).toEqual([failure, Reflect.get(new Object(failure), 'cause')]);
    expect(causesOf(failedWith(...Array.from({ length: 12 }, (_, index) => `E${index}`)))).toHaveLength(8);
    expect(causesOf('not an error')).toEqual([]);
  });

  it('name the code of each, where it has one', () => {
    expect(codesOf(failedWith(undefined, 'ECONNREFUSED'))).toEqual([undefined, 'ECONNREFUSED']);
  });
});
