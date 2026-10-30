import { describe, expect, it } from 'vitest';

import { jsonBytesOf, type Json } from '../dsl/json.ts';
import { jsonBytesWithin, textCutAt, textWithin } from './byte-sizes.ts';

const everyCodeUnitBelow256 = Array.from({ length: 256 }, (_, unit) => String.fromCodePoint(unit)).join('');

const characters = [
  everyCodeUnitBelow256,
  '"quoted" and \\ backslashed',
  '\u007F\u0080\u07FF\u0800\uFFFF\u2028\u2029',
  'emoji \u{1F600} and flags \u{1F1EC}\u{1F1E7}',
  'a lone high \uD83D surrogate',
  'a lone low \uDE00 surrogate',
  '\uD83D',
  '',
];

const numbers = [0, -0, 1, -1, 0.1, 1e21, 1.5e-7, 5e-324, 1.7976931348623157e308, 9_007_199_254_740_992];

function seeded(seed: number): () => number {
  const state = { seed };
  return () => {
    state.seed = (state.seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state.seed / 2_147_483_648;
  };
}

function generated(next: () => number, depth: number): Json {
  const pick = Math.floor(next() * (depth > 3 ? 4 : 6));
  const scalars: readonly (() => Json)[] = [
    () => characters[Math.floor(next() * characters.length)] ?? '',
    () => numbers[Math.floor(next() * numbers.length)] ?? 0,
    () => next() > 0.5,
    () => null,
  ];
  const containers: readonly (() => Json)[] = [
    () => Array.from({ length: Math.floor(next() * 4) }, () => generated(next, depth + 1)),
    () =>
      Object.fromEntries(
        Array.from({ length: Math.floor(next() * 4) }, (_, index) => [
          `${characters[index % characters.length] ?? ''}${index}`,
          generated(next, depth + 1),
        ]),
      ),
  ];
  const choice = [...scalars, ...containers][pick] ?? (() => null);
  return choice();
}

const values: readonly Json[] = [
  ...characters,
  ...numbers,
  true,
  false,
  null,
  [],
  {},
  [[], {}, [null]],
  { a: { b: [1, 'x', { c: '\n' }] } },
  ...Array.from({ length: 300 }, (_, seed) => generated(seeded(seed + 1), 0)),
];

describe('the size of a value as JSON, measured without writing it', () => {
  it('is the number of bytes of its JSON in UTF-8, escapes and surrogates counted as JSON writes them', () => {
    expect(values.map((value) => jsonBytesWithin(value, Number.POSITIVE_INFINITY))).toEqual(
      values.map((value) => jsonBytesOf(value)),
    );
  });

  it('stops counting once the count passes the most it is asked about', () => {
    const control = '\u0001Ā'.repeat(15_000_000);

    expect(jsonBytesWithin(control, 1000)).toBeGreaterThan(1000);
    expect(jsonBytesWithin(control, 1000)).toBeLessThan(1100);
    expect(jsonBytesWithin([control, control], 1000)).toBeLessThan(1100);
    expect(jsonBytesWithin({ [control]: control }, 1000)).toBeLessThan(1100);
    expect(jsonBytesWithin(['x', 'y', 'z'], 4)).toBeGreaterThan(4);
    expect(jsonBytesWithin({ a: 1, b: 2 }, 5)).toBeGreaterThan(5);
  });
});

describe('a text cut to a number of bytes', () => {
  it('is the text itself when it fits', () => {
    expect(textWithin('stop', 4)).toBe('stop');
    expect(textWithin('', 0)).toBe('');
  });

  it('keeps the whole characters that fit in UTF-8, never half of one, and marks the cut', () => {
    expect(textWithin('x'.repeat(30_000_000), 1024)).toBe(`${'x'.repeat(1024)}…`);
    expect(textWithin('é'.repeat(10), 5)).toBe('éé…');
    expect(textWithin('\u{1F600}\u{1F600}', 5)).toBe('\u{1F600}…');
    expect(textWithin('ab', 0)).toBe('…');
  });
});

describe('a text cut at a number of bytes, unmarked', () => {
  it('keeps the whole characters that fit in UTF-8, never half of one, the bytes a TextEncoder makes of them', () => {
    const lone = '\uD800';

    expect([textCutAt('stop', 4), textCutAt('', 0), textCutAt('ab', 0)]).toEqual(['stop', '', '']);
    expect([textCutAt('é'.repeat(10), 5), textCutAt('\u{1F600}\u{1F600}', 5)]).toEqual(['éé', '\u{1F600}']);
    expect([textCutAt(`${lone}x`, 3), textCutAt(`${lone}x`, 2)]).toEqual([lone, '']);
    expect(new TextEncoder().encode(lone).byteLength).toBe(3);
  });
});
