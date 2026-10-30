import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { inWords, nameInWords, outputInWords } from '../index.ts';

const renderings: ReadonlyArray<readonly [Schema.Json, string]> = [
  ['Profits rose.', '“Profits rose.”'],
  [42, '42'],
  [true, 'yes'],
  [false, 'no'],
  [null, 'nothing'],
  [[], 'an empty list'],
  [['a', 'b'], '“a” and “b”'],
  [
    [{ user: 'ada', text: 'Shipped.' }, { user: 'grace', text: 'Thanks.' }, {}],
    '(user: “ada” and text: “Shipped.”), (user: “grace” and text: “Thanks.”), and nothing',
  ],
  [{}, 'nothing'],
  [{ approve: true }, 'approve: yes'],
  [{ approve: true, reason: 'cheap' }, 'approve: yes and reason: “cheap”'],
  [
    { customer: { first_name: 'Ada' }, tags: [], extra: {} },
    'customer: (first name: “Ada”), tags: an empty list, and extra: nothing',
  ],
];

describe('inWords', () => {
  it.each(renderings)('renders %j as %s', (value, words) => {
    expect(inWords(value)).toBe(words);
  });

  it('gives up on a value too long to repeat in a sentence', () => {
    expect(inWords('a'.repeat(299))).toBeUndefined();
  });

  it('renders a value that just fits', () => {
    expect(inWords('a'.repeat(298))).toBe(`“${'a'.repeat(298)}”`);
  });

  it('counts a character outside the Basic Multilingual Plane once, as a person reads it', () => {
    expect([inWords('😀'.repeat(298)), inWords('😀'.repeat(299))]).toEqual([`“${'😀'.repeat(298)}”`, undefined]);
  });
});

describe('outputInWords', () => {
  it('says the answer or the result in words, or that it is too long to repeat', () => {
    expect([
      outputInWords('answer')({ approve: true }),
      outputInWords('result')([{ verdict: 'approve' }]),
      outputInWords('result')('a'.repeat(299)),
    ]).toEqual([
      'Its answer: approve: yes.',
      'Its result: (verdict: “approve”).',
      'Its result is too long to repeat here; the whole of it is in the details below.',
    ]);
  });
});

describe('nameInWords', () => {
  it.each([
    ['customer_name', 'customer name'],
    ['maxTokens', 'max tokens'],
    ['order-id', 'order id'],
    ['text', 'text'],
  ])('turns %s into %s', (name, words) => {
    expect(nameInWords(name)).toBe(words);
  });
});
