import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { schemaBlocks } from '../index.ts';

function wordsOf(field: Schema.JsonObject): string {
  const [block] = schemaBlocks({ type: 'object', properties: { field } }, '');
  const words = block?.kind === 'fields' ? (block.rows[0]?.words ?? []) : [];
  return words.map((phrase) => (typeof phrase === 'string' ? phrase : Object.values(phrase).join(''))).join('');
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
      'A date.',
      'A date and time.',
      'A time.',
      'An email address.',
      'A URI.',
      'A UUID.',
      'A list of dates.',
      'A list of URIs.',
      'A list of 1 to 3 UUIDs.',
      'A list of at most 1 email address.',
    ]);
  });
});
