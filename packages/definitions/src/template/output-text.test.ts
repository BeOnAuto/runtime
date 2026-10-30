import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { outputText } from '../template.ts';

describe('the text of a value a template writes', () => {
  const values: ReadonlyArray<readonly [string, Schema.Json | undefined, string]> = [
    ['text', 'hi', 'hi'],
    ['nothing', null, ''],
    ['undefined', undefined, ''],
    ['a number', 3, '3'],
    ['a boolean', false, 'false'],
    ['a list, its items joined', ['a', 1, ['b', null]], 'a1b'],
    ['an object', { a: 1 }, '[object Object]'],
  ];

  it.each(values)('writes %s as Liquid writes it', (_case, value, text) => {
    expect(outputText(value)).toBe(text);
  });
});
