import { Buffer } from 'node:buffer';

import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { bytesAsJsonOf } from './bytes-as-json.ts';

const everyEscape = Array.from({ length: 0x80 }, (_, code) => String.fromCodePoint(code)).join('');

const values: readonly Schema.Json[] = [
  null,
  true,
  false,
  0,
  -0,
  -12.5,
  1e21,
  5e-7,
  Number.MAX_SAFE_INTEGER,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  '',
  'plain text',
  everyEscape,
  'é ✓ \u{1D11E}    ߿ ࠀ ￿',
  '\uD834 half alone, \uDD1E the other half alone, \uD834𝄞 a half then a pair',
  'ends in half \uD834',
  [],
  {},
  [1, 'two', null, [true, { three: 3 }]],
  { b: 1, '10': 2, '2': 3, 'a "quoted" key\n': { nested: ['é', {}] } },
  Object.fromEntries([['__proto__', { a: 1 }]]),
];

describe('the bytes of a value as JSON', () => {
  it.each(values.map((value): readonly [string, Schema.Json] => [JSON.stringify(value), value]))(
    'are those of %s written out in UTF-8, counted without writing it',
    (_written, value) => {
      expect(bytesAsJsonOf(value)).toBe(Buffer.byteLength(JSON.stringify(value), 'utf8'));
    },
  );
});
