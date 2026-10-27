import { describe, expect, it } from 'vitest';

import { required } from './required.ts';

const values: ReadonlyMap<string, string> = new Map([['present', 'there']]);

describe('a value that must be there', () => {
  it('is answered where it is, and dies where it is not', () => {
    expect(required(values.get('present'))).toBe('there');
    expect(() => required(values.get('absent'))).toThrow('getOrThrow called on a None');
  });
});
