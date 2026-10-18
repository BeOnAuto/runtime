import { describe, expect, it } from 'vitest';

import { charactersIn } from '../index.ts';
import { firstCharacters } from './characters.ts';

describe('the characters of a text', () => {
  it('are its code points, a character outside the Basic Multilingual Plane counted once', () => {
    expect([charactersIn(''), charactersIn('abc'), charactersIn('😀😀'), charactersIn('a\uD800b')]).toEqual([
      0, 3, 2, 3,
    ]);
  });
});

describe('the first characters of a text', () => {
  it('counts code points, not halves of them', () => {
    expect([firstCharacters('abc', 2), firstCharacters('😀😀😀', 2), firstCharacters('ab', 2)]).toEqual([
      'ab',
      '😀😀',
      'ab',
    ]);
  });
});
