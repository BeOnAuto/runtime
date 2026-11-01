import { describe, expect, it } from 'vitest';

import { alternatives, articled, asSentence, capitalized, counted, listed, plainNumber, quoted } from '../index.ts';

const reasoningFunction = { one: 'reasoning function', other: 'reasoning functions' };

const lists: ReadonlyArray<readonly [readonly string[], string]> = [
  [['a'], 'a'],
  [['a', 'b'], 'a and b'],
  [['a', 'b', 'c'], 'a, b, and c'],
];

describe('phrasing', () => {
  it('quotes a name with typographic quotes', () => {
    expect(quoted('Sales')).toBe('“Sales”');
  });

  it.each(lists)('lists %j as %s', (items, text) => {
    expect(listed(items)).toBe(text);
  });

  it('capitalizes the first letter of a sentence, and leaves one that starts with a quote', () => {
    expect([capitalized('the reasoning function'), capitalized('“summary” is'), capitalized('')]).toEqual([
      'The reasoning function',
      '“summary” is',
      '',
    ]);
  });

  it('gives a noun the article its first letter takes', () => {
    expect([articled('reasoning function'), articled('interaction function'), articled('workflow')]).toEqual([
      'a reasoning function',
      'an interaction function',
      'a workflow',
    ]);
  });

  it('lists alternatives with or', () => {
    expect(alternatives(['reasoning function', 'workflow'])).toBe('reasoning function or workflow');
  });

  it.each([
    [0, '0 reasoning functions'],
    [1, '1 reasoning function'],
    [2, '2 reasoning functions'],
    [100, 'one hundred reasoning functions'],
  ])('counts %i as %s', (count, text) => {
    expect(counted(count, reasoningFunction)).toBe(text);
  });
});

describe('a number in plain words', () => {
  it.each([
    [99, '99'],
    [100, 'one hundred'],
    [101, 'one hundred and one'],
    [115, 'one hundred and fifteen'],
    [240, 'two hundred and forty'],
    [342, 'three hundred and forty-two'],
    [599, 'five hundred and ninety-nine'],
    [600, '600'],
    [2.5, '2.5'],
  ])('writes %d in words only where digits could read as a status code, as %s', (number, words) => {
    expect(plainNumber(number)).toBe(words);
  });
});

describe('phrasing a sentence', () => {
  it.each([
    ['Summarizes a text', 'Summarizes a text.'],
    ['  Summarizes a text.  ', 'Summarizes a text.'],
    ['Is it done?', 'Is it done?'],
    ['Says “hi!”', 'Says “hi!”'],
  ])('makes %j a sentence', (text, sentence) => {
    expect(asSentence(text)).toBe(sentence);
  });
});
