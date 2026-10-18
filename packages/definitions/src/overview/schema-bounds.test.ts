import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { plainTextOf, schemaBlocks, type Phrases } from '../index.ts';

function plain(phrases: Phrases): string {
  return phrases.map((phrase) => (typeof phrase === 'string' ? phrase : `**${plainTextOf([phrase])}**`)).join('');
}

function wordsOf(field: Schema.JsonObject): string {
  const [block] = schemaBlocks({ type: 'object', properties: { field } }, '');
  return block?.kind === 'fields' ? plain(block.rows[0]?.words ?? []) : '';
}

function listOf(items: Schema.JsonObject): string {
  return wordsOf({ type: 'array', items });
}

describe('the bounds of a schema in words', () => {
  it('say the bounds of a number and a text after it, of a list before its items, and the default a field takes', () => {
    expect([
      wordsOf({ type: 'integer', minimum: 1, maximum: 50, default: 5 }),
      wordsOf({ type: 'integer', minimum: 1000 }),
      wordsOf({ type: 'number', maximum: 0.5 }),
      wordsOf({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 100 }),
      wordsOf({ type: 'string', maxLength: 200 }),
      wordsOf({ type: 'string', minLength: 1 }),
      wordsOf({ type: 'string', minLength: 2, maxLength: 3, default: 'abc' }),
      wordsOf({ type: 'array', items: { type: 'integer' }, minItems: 1 }),
      wordsOf({ type: 'array', maxItems: 1 }),
      wordsOf({ enum: ['draft', 'sent'], default: 'draft' }),
      wordsOf({ type: 'string', default: 'x'.repeat(400) }),
    ]).toEqual([
      'A whole number, from 1 to 50, 5 when left out.',
      'A whole number, at least 1,000.',
      'A number, at most 0.5.',
      'A number, more than 0, less than 100.',
      'Text, at most 200 characters.',
      'Text, at least 1 character.',
      'Text, 2 to 3 characters, “abc” when left out.',
      'A list of at least 1 whole number.',
      'A list of at most 1 item.',
      'One of: draft, sent; “draft” when left out.',
      'Text, a default when left out.',
    ]);
  });
});

describe('the bounds of a container in words', () => {
  it('say how many items a list holds before what each item is, in the plural, and in the singular for one', () => {
    expect([
      listOf({ type: 'string' }),
      wordsOf({ type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', maxLength: 200 } }),
      wordsOf({ type: 'array', maxItems: 3, items: { type: 'integer', minimum: 1, maximum: 50 } }),
      wordsOf({ type: 'array', minItems: 1, items: { type: 'string', format: 'date-time' } }),
      wordsOf({ type: 'array', maxItems: 2, items: { type: 'boolean' } }),
      wordsOf({ type: 'array', maxItems: 1, items: { type: 'null' } }),
      wordsOf({ type: 'array', maxItems: 5, items: {} }),
      wordsOf({ type: 'array', minItems: 1, items: { type: 'object' } }),
      wordsOf({ type: 'array', minItems: 2, items: { type: 'array', maxItems: 3, items: { type: 'number' } } }),
      wordsOf({ type: 'array', minItems: 1, items: { type: 'array' } }),
    ]).toEqual([
      'A list of text.',
      'A list of 1 to 10 text values, each at most 200 characters.',
      'A list of at most 3 whole numbers, each from 1 to 50.',
      'A list of at least 1 date and time.',
      'A list of at most 2 yes-or-no values.',
      'A list of at most 1 empty value.',
      'A list of at most 5 values.',
      'A list of at least 1 record.',
      'A list of at least 2 lists of at most 3 numbers.',
      'A list of at least 1 list.',
    ]);
  });
});

describe('equal bounds in words', () => {
  it('say exactly how many items, entries or characters, and exactly the number, never one to the same', () => {
    expect([
      wordsOf({ type: 'array', minItems: 1, maxItems: 1, items: { type: 'object' } }),
      wordsOf({ type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer' } }),
      wordsOf({ type: 'array', minItems: 2, maxItems: 2 }),
      wordsOf({ type: 'object', minProperties: 1, maxProperties: 1, additionalProperties: { type: 'string' } }),
      wordsOf({ type: 'string', minLength: 5, maxLength: 5 }),
      wordsOf({ type: 'integer', minimum: 5, maximum: 5 }),
    ]).toEqual([
      'A list of exactly 1 record.',
      'A list of exactly 3 whole numbers.',
      'A list of exactly 2 items.',
      'A record of exactly 1 entry, each text.',
      'Text, exactly 5 characters.',
      'A whole number, exactly 5.',
    ]);
  });
});

describe('the bounds of a list of choices, alternatives or records in words', () => {
  it('are said before them', () => {
    expect([
      wordsOf({ type: 'array', maxItems: 3, items: { enum: ['a', 'b'] } }),
      wordsOf({ type: 'array', minItems: 1, items: { enum: ['a', 'b'] } }),
      wordsOf({ type: 'array', maxItems: 3, items: { const: 'a' } }),
      wordsOf({ type: 'array', minItems: 1, items: { const: 'a' } }),
      wordsOf({ type: 'array', maxItems: 3, items: { anyOf: [{ type: 'integer' }, { type: 'string' }] } }),
      wordsOf({ type: 'array', minItems: 1, items: { anyOf: [{ type: 'integer' }, { type: 'string' }] } }),
      wordsOf({ type: 'array', maxItems: 3, items: { oneOf: Array.from({ length: 5 }, () => ({ type: 'string' })) } }),
      wordsOf({
        type: 'array',
        maxItems: 20,
        items: { type: 'object', required: ['at'], properties: { at: { type: 'string' } } },
      }),
    ]).toEqual([
      'A list of at most 3 values, each one of: a, b.',
      'A list of at least 1 value, one of: a, b.',
      'A list of at most 3 values, each exactly a.',
      'A list of at least 1 value, exactly a.',
      'A list of at most 3 whole numbers or text values.',
      'A list of at least 1 whole number or text value.',
      'A list of at most 3 values of 5 kinds.',
      'A list of at most 20 records with: **at** (text).',
    ]);
  });
});

describe('the bounds of a record in words', () => {
  it('say how many entries a record holds before its fields, and beneath a record or a list', () => {
    expect([
      wordsOf({ type: 'object', maxProperties: 3, properties: { a: { type: 'string' } } }),
      wordsOf({ type: 'object', properties: { inner: { type: 'object', minProperties: 1, maxProperties: 9 } } }),
      listOf({ type: 'object', maxProperties: 2, additionalProperties: { type: 'string' } }),
      listOf({ type: 'object', minProperties: 1, properties: { a: { type: 'string' } } }),
    ]).toEqual([
      'A record of at most 3 entries with: **a** (text, optional).',
      'A record with: **inner** (a record of 1 to 9 entries, optional).',
      'A list of records of at most 2 entries, each text.',
      'A list of records of at least 1 entry with: **a** (text, optional).',
    ]);
  });
});

describe('the bounds of a list or a record that its words do not hold', () => {
  it('follow a schema that is not one, or that is a choice or alternatives', () => {
    expect([
      wordsOf({ type: ['array', 'null'], maxItems: 2, items: { type: 'integer' } }),
      wordsOf({ type: 'string', maxItems: 2, maxProperties: 3 }),
      wordsOf({ maxItems: 2 }),
      wordsOf({ type: 'array', enum: [['a'], ['b']], maxItems: 1 }),
      wordsOf({ anyOf: [{ type: 'array' }, { type: 'null' }], maxItems: 4 }),
    ]).toEqual([
      'A list of at most 2 whole numbers or nothing.',
      'Text, at most 2 items, at most 3 entries.',
      'Any value, at most 2 items.',
      'One of: ["a"], ["b"]; at most 1 item.',
      'A list or nothing, at most 4 items.',
    ]);
  });
});

describe('a record of entries in words', () => {
  it('says how many entries a record without fields may have before what every entry is', () => {
    const reviews = { type: 'array', maxItems: 20, items: { type: 'object', properties: { at: { type: 'string' } } } };

    expect([
      wordsOf({ type: 'object', maxProperties: 50, additionalProperties: reviews }),
      wordsOf({ type: 'object', minProperties: 1, additionalProperties: { type: 'integer' } }),
      listOf({ type: 'object', additionalProperties: { type: 'string' } }),
      wordsOf({ type: 'object', additionalProperties: false }),
      wordsOf({ type: 'object', properties: { a: { type: 'object', additionalProperties: { type: 'string' } } } }),
      wordsOf({ type: 'object', minProperties: 2, maxProperties: 4 }),
    ]).toEqual([
      'A record of at most 50 entries, each a list of at most 20 records with: **at** (text, optional).',
      'A record of at least 1 entry, each a whole number.',
      'A list of records whose every entry is text.',
      'A record.',
      'A record with: **a** (a record, optional).',
      'A record of 2 to 4 entries.',
    ]);
  });
});
