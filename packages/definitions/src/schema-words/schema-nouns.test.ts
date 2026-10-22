import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { expectedWordsOf } from './schema-words.ts';

function wordsOf(field: Schema.JsonObject): string {
  return expectedWordsOf(field, field);
}

function listOf(items: Schema.JsonObject): string {
  return wordsOf({ type: 'array', items });
}

describe('the form of a string in words', () => {
  it('says each form the runtime checks by its name, in the singular and the plural, and counted', () => {
    expect([
      ...['date', 'date-time', 'time', 'email', 'uri', 'uuid'].map((format) => wordsOf({ type: 'string', format })),
      listOf({ type: 'string', format: 'date' }),
      listOf({ type: 'string', format: 'uri' }),
      wordsOf({ type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', format: 'uuid' } }),
      wordsOf({ type: 'array', maxItems: 1, items: { type: 'string', format: 'email' } }),
    ]).toEqual([
      'a date',
      'a date and time',
      'a time',
      'an email address',
      'a URI',
      'a UUID',
      'a list of dates',
      'a list of URIs',
      'a list of 1 to 3 UUIDs',
      'a list of at most 1 email address',
    ]);
  });
});
