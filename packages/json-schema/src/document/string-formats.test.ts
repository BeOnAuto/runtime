import { describe, expect, it } from 'vitest';

import { fieldIssues, formatRefusal } from '../testing/compiled-fields.ts';
import { stringFormats, type FormatName } from './string-formats.ts';

const forms: readonly (readonly [FormatName, readonly string[], readonly string[]])[] = [
  [
    'date',
    ['2026-04-01', '2024-02-29', '2000-02-29', '0000-02-29', '2026-12-31'],
    [
      'April',
      '2026-02-29',
      '1900-02-29',
      '2026-04-31',
      '2026-04-00',
      '2026-13-01',
      '2026-00-10',
      '2026-4-1',
      '20260401',
      '2026-04-01T09:30:00Z',
      '２０２６-04-01',
      ' 2026-04-01',
      '2'.repeat(100_000),
    ],
  ],
  [
    'date-time',
    [
      '2026-04-01T09:30:00Z',
      '2026-04-01t09:30:00z',
      '2026-04-01T09:30:00.123+05:30',
      '2026-04-01T00:00:00-00:00',
      '1998-12-31T23:59:60Z',
      '1998-12-31T15:59:60.123-08:00',
      '1999-01-01T00:29:60+00:30',
    ],
    [
      'April 1st, 9:30',
      '2026-04-01 09:30:00Z',
      '2026-04-01T09:30:00',
      '2026-04-01T09:30Z',
      '2026-04-01T24:00:00Z',
      '2026-04-01T09:60:00Z',
      '2026-04-01T09:30:61Z',
      '1998-12-31T23:58:60Z',
      '1998-12-31T22:59:60Z',
      '2026-04-01T09:30:00+24:00',
      '2026-04-01T09:30:00+05:60',
      '2026-02-30T09:30:00Z',
      `2026-04-01T09:30:00.${'1'.repeat(100_000)}`,
    ],
  ],
  [
    'time',
    ['09:30:00Z', '09:30:00z', '09:30:00.5-07:00', '23:59:60Z', '00:29:60+00:30', '23:29:60-00:30'],
    ['09:30', '09:30:00', '9:30:00Z', '24:00:00Z', '09:60:00Z', '22:59:60Z', '09:30:00+5:00', 'noon'],
  ],
  [
    'email',
    ['name@example.com', 'first.last+tag@mail.example.co', 'Name@Example.COM', 'name@localhost', "o'neil@x-y.example"],
    [
      'name',
      'name@',
      '@example.com',
      'name@-example.com',
      'name@example-.com',
      'name@example..com',
      'na me@example.com',
      'name@exämple.com',
      `name@${'a'.repeat(64)}.com`,
      `${'a'.repeat(100_000)}@`,
      `name@${'a.'.repeat(50_000)}-`,
    ],
  ],
  [
    'uri',
    [
      'https://example.com',
      'https://example.com/a?b=c#d',
      'mailto:name@example.com',
      'urn:isbn:0451450523',
      'https://example.com/a%20b',
      'http://[::1]/',
      "https://example.com/(a)!$&'*+,;=~@:",
    ],
    [
      'example.com',
      '/relative/path',
      'https://',
      'https://exa mple.com',
      '',
      ' https://example.com',
      'https://example.com ',
      'https://example.com/a b',
      'https://example.com/a\nb',
      'https://example.com/a\tb',
      'https://example.com/a\u0000b',
      'https://example.com/a\u007Fb',
      'https://example.com/a\u00A0b',
      'https://example.com/a\u2003b',
      'https://例え.jp',
      'https://example.com/café',
      'https://example.com\\path',
      'https://example.com/"a"',
      'https://example.com/<a>',
      'https://example.com/{a}',
      'https://example.com/a|b',
      'https://example.com/a^b',
      'https://example.com/`a`',
      'https://example.com/%zz',
      'https://example.com/%2',
      `https://example.com/${'a'.repeat(100_000)} `,
    ],
  ],
  [
    'uuid',
    [
      '0f8fad5b-d9cb-469f-a165-70867728950e',
      '0F8FAD5B-D9CB-469F-A165-70867728950E',
      '00000000-0000-0000-0000-000000000000',
    ],
    [
      '0f8fad5bd9cb469fa16570867728950e',
      '0f8fad5b-d9cb-469f-a165-70867728950',
      '0f8fad5b-d9cb-469f-a165-70867728950e0',
      'g f8fad5b-d9cb-469f-a165-70867728950e',
      '{0f8fad5b-d9cb-469f-a165-70867728950e}',
    ],
  ],
];

describe('a string in a format the compiler checks', () => {
  it.each(forms)('is taken in the form %s, and refused out of it with a breach of its own', (format, held, broken) => {
    const field = { type: 'string', format };

    expect(held.map((value) => fieldIssues(field, value))).toEqual(held.map(() => []));
    expect(broken.map((value) => fieldIssues(field, value))).toEqual(broken.map(() => [formatRefusal(format)]));
  });

  it.each(forms)('takes the example the words of %s give', (format) => {
    expect(fieldIssues({ type: 'string', format }, stringFormats[format].example)).toEqual([]);
  });

  it('is refused for its other bounds too, and once for its format', () => {
    expect(fieldIssues({ type: 'string', maxLength: 4, format: 'date' }, 'April')).toEqual([
      {
        pointer: '/field',
        detail: 'Expected a string with at most 4 code points',
        breach: { rule: 'bound', keywords: { maxLength: 4 } },
      },
      formatRefusal('date'),
    ]);
  });
});
