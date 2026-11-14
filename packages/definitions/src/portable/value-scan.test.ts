import { describe, expect, it } from 'vitest';

import { findingId, findingsIn, scanFormOf, standingMatchesIn, writtenSpanOf } from './value-scan.ts';

describe('the scan', () => {
  it('names a finding by a hash of its class and value', () => {
    expect(findingId('address', 'owner@example.com')).toMatch(/^[0-9a-f]{32}$/u);
    expect(findingId('address', 'owner@example.com')).toBe(findingId('address', 'owner@example.com'));
    expect(findingId('id', 'owner@example.com')).not.toBe(findingId('address', 'owner@example.com'));
  });

  it('finds one value once wherever it occurs, with each place and line', () => {
    const findings = findingsIn([
      { part: 'goals', text: 'Tell owner@example.com' },
      { part: 'page', text: 'owner@example.com and owner@example.com\n\n#news' },
      { part: 'definition', name: 'lookup/read', field: 'overview', text: 'For #news' },
    ]);
    expect(findings).toEqual([
      {
        id: findingId('address', 'owner@example.com'),
        class: 'address',
        value: 'owner@example.com',
        occurrences: [
          { part: 'goals', line: 1 },
          { part: 'page', line: 1 },
        ],
      },
      {
        id: findingId('handle', '#news'),
        class: 'handle',
        value: '#news',
        occurrences: [
          { part: 'page', line: 3 },
          { part: 'definition', name: 'lookup/read', field: 'overview', line: 1 },
        ],
      },
    ]);
  });
});

describe('the scan of values found twice or blank', () => {
  it('counts a value found by two shapes of one class once', () => {
    expect(findingsIn([{ part: 'page', text: 'channel: C04ABC12DE99\n' }]).map(({ value }) => value)).toEqual([
      'C04ABC12DE99',
    ]);
  });

  it('never takes a blank for a finding, but still finds a secret beside one', () => {
    const text = [
      'to: owner@owner.blank.invalid',
      'channel: AUTO_BLANK_NEWS_CHANNEL1',
      'link: https://shop.blank.invalid/orders?channel=C04ABC12DE',
      'hook: https://shop.blank.invalid/in?token=abc',
    ].join('\n');
    expect(standingMatchesIn(text).map(({ class: valueClass, value }) => `${valueClass} ${value}`)).toEqual([
      'id C04ABC12DE',
      'secret https://shop.blank.invalid/in?token=abc',
    ]);
  });

  it('still finds a value that only touches a blank, or whose host merely holds one', () => {
    const text = [
      'a: https://shop.example.blank.invalid.example.com/orders',
      'b: https://AUTO_BLANK_SHOP.example.com/orders',
      'd: https://mail.shop.blank.invalid/in and june.park@shop.blank.invalid',
    ].join('\n');
    expect(standingMatchesIn(text).map(({ value }) => value)).toEqual([
      'https://shop.example.blank.invalid.example.com/orders',
      'shop.example.blank.invalid.example.com',
      'https://AUTO_BLANK_SHOP.example.com/orders',
      'AUTO_BLANK_SHOP.example.com',
    ]);
  });
});

const hidden: readonly (readonly [string, string])[] = [
  ['wide letters', 'Mail \uFF42\uFF4F\uFF42\uFF20\uFF41\uFF43\uFF4D\uFF45\uFF0E\uFF43\uFF4F\uFF4D weekly'],
  ['a zero-width space', 'Mail bob\u200B@acme.com weekly'],
  ['a soft hyphen', 'Mail bob@ac\u00ADme.com weekly'],
  ['a zero-width joiner', 'Mail bob@acme\u200D.com weekly'],
  ['a zero-width non-joiner', 'Mail b\u200Cob@acme.com weekly'],
  ['a word joiner', 'Mail bob@\u2060acme.com weekly'],
  ['a byte order mark', 'Mail bob@acme.\uFEFFcom weekly'],
  ['a left-to-right mark', 'Mail bob\u200E@acme.com weekly'],
  ['a combining grapheme joiner', 'Mail bob@acme\u034F.com weekly'],
  ['a variation selector', 'Mail bob\uFE0F@acme.com weekly'],
  ['a Hangul filler', 'Mail bob@acme\u3164.com weekly'],
  ['the small commercial at', 'Mail bob\uFE6Bacme.com weekly'],
  ['circled letters', 'Mail \u24D1\u24DE\u24D1@acme.com weekly'],
  ['mathematical letters', 'Mail \u{1D41B}\u{1D428}\u{1D41B}@acme.com weekly'],
];

describe('a value hidden by a character the eye does not part it by', () => {
  it.each(hidden)('is found through %s, as the address it spells', (_, text) => {
    expect(findingsIn([{ part: 'page', text }]).map(({ class: found, value }) => [found, value])).toEqual([
      ['address', 'bob@acme.com'],
    ]);
  });
});

const unicode = (hex: string): string => `\\u${hex}`;

const escapedCopies: readonly (readonly [string, string])[] = [
  ['a JSON unicode escape', `x: "bob${unicode('0040')}acme.com"`],
  ['a JavaScript braced escape', String.raw`x = 'bob\u{40}acme.com'`],
  ['a JavaScript byte escape', String.raw`x = 'bob\x40acme\x2Ecom'`],
  ['a decimal character reference', '<a>bob&#64;acme.com</a>'],
  ['a hexadecimal character reference', '<a>bob&#x40;acme&#X2e;com</a>'],
  ['a named character reference', '<a>bob&commat;acme&period;com</a>'],
  ['percent-encoding', 'mail bob%40acme%2Ecom weekly'],
  ['an escape of a letter', `x: "${unicode('0062')}ob@acme.com"`],
  ['an escape of a character the eye does not part it by', `x: "bob${unicode('200B')}@acme.com"`],
];

describe('a value written with escapes', () => {
  it.each(escapedCopies)('is found through %s, as the address it spells', (_, text) => {
    expect(findingsIn([{ part: 'page', text }]).map(({ class: found, value }) => [found, value])).toEqual([
      ['address', 'bob@acme.com'],
    ]);
  });

  it('keeps an escape as it is written where it would part text or names no character', () => {
    const written = String.raw`a\u000Ab%20c%2Fd&#9;e&amp;f&nbsp;g\u{110000}h&#xD800;i`;
    expect(scanFormOf(written).text).toBe(written);
  });

  it('knows each escape was written as one character', () => {
    const form = scanFormOf(`b${unicode('0040')}c`);
    expect(form.text).toBe('b@c');
    expect(writtenSpanOf(form, { from: 1, to: 2 })).toEqual({ from: 1, to: 7 });
    expect(writtenSpanOf(form, { from: 2, to: 3 })).toEqual({ from: 7, to: 8 });
  });
});

describe('the form the scan reads', () => {
  it('drops what is not seen, writes compatibility forms plainly and knows where each part was written', () => {
    const form = scanFormOf('a\u200Bb\u33A2c\u{1D41B}');
    expect(form.text).toBe('abkm2cb');
    expect(writtenSpanOf(form, { from: 0, to: 2 })).toEqual({ from: 0, to: 3 });
    expect(writtenSpanOf(form, { from: 2, to: 3 })).toEqual({ from: 3, to: 4 });
    expect(writtenSpanOf(form, { from: 6, to: 7 })).toEqual({ from: 5, to: 7 });
  });
});
