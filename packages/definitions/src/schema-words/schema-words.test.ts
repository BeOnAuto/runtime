import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { descriptionOf, examplesWordsOf, expectedWordsOf } from './schema-words.ts';

function wordsOf(field: Schema.JsonObject, root = field): string {
  return expectedWordsOf(field, root);
}

function listOf(items: Schema.JsonObject): string {
  return wordsOf({ type: 'array', items });
}

describe('the words of a simple schema', () => {
  it('say a field of each simple type in words', () => {
    expect([
      wordsOf({ type: 'string' }),
      wordsOf({ type: 'string', format: 'date-time' }),
      wordsOf({ type: 'string', format: 'email' }),
      wordsOf({ type: 'string', format: 'phone' }),
      wordsOf({ type: 'integer' }),
      wordsOf({ type: 'number' }),
      wordsOf({ type: 'boolean' }),
      wordsOf({ type: 'null' }),
      wordsOf({}),
      wordsOf({ type: 'mystery' }),
    ]).toEqual([
      'text',
      'a date and time',
      'an email address',
      'text in the form the schema calls phone',
      'a whole number',
      'a number',
      'yes or no',
      'nothing',
      'any value',
      'any value',
    ]);
  });

  it('say the values a field may take, and that a field takes one value alone', () => {
    expect([
      wordsOf({ enum: ['draft', 'sent', 3, null] }),
      wordsOf({ enum: Array.from({ length: 14 }, (_, index) => `v${index}`) }),
      wordsOf({ const: 'approve' }),
      wordsOf({ const: null }),
      wordsOf({ enum: 'not a list', type: 'string' }),
    ]).toEqual([
      'one of: draft, sent, 3, null',
      'one of: v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, and 2 more',
      'exactly approve',
      'exactly null',
      'text',
    ]);
  });
});

describe('a list in words', () => {
  it('says a list of each kind, and a list of lists, in the plural', () => {
    expect([
      listOf({ type: 'string' }),
      listOf({ type: 'string', format: 'date-time' }),
      listOf({ type: 'number' }),
      listOf({ type: 'boolean' }),
      listOf({ type: 'null' }),
      listOf({ type: 'array', items: { type: 'integer' } }),
      listOf({ type: 'object' }),
      listOf({ enum: ['a', 'b'] }),
      listOf({ const: 1 }),
      listOf({}),
      listOf({ anyOf: [{ type: 'integer' }, { type: 'string' }] }),
      listOf({ oneOf: Array.from({ length: 5 }, () => ({ type: 'string' })) }),
      wordsOf({ type: 'array', items: [{ type: 'string' }] }),
    ]).toEqual([
      'a list of text',
      'a list of dates and times',
      'a list of numbers',
      'a list of yes-or-no values',
      'a list of empty values',
      'a list of lists of whole numbers',
      'a list of records',
      'a list of values, each one of: a, b',
      'a list of values, each exactly 1',
      'a list of any values',
      'a list of whole numbers or text',
      'a list of values of 5 kinds',
      'a list',
    ]);
  });
});

describe('the bounds of the items of a list in words', () => {
  it('are said of each item, after the bound of the list or without one', () => {
    expect([
      wordsOf({ type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', maxLength: 200 } }),
      wordsOf({ type: 'array', maxItems: 3, items: { type: 'integer', minimum: 1, maximum: 50 } }),
      listOf({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 }),
      listOf({ type: 'string', minLength: 1, default: 'x' }),
      listOf({ enum: ['a', 'b'], default: 'a' }),
      listOf({ anyOf: [{ type: 'integer', minimum: 1 }, { type: 'string' }] }),
      wordsOf({ type: 'object', maxProperties: 3, additionalProperties: { type: 'integer', minimum: 1 } }),
    ]).toEqual([
      'a list of 1 to 10 text values, each at most 200 characters',
      'a list of at most 3 whole numbers, each from 1 to 50',
      'a list of numbers, each more than 0, less than 1',
      'a list of text, each at least 1 character, “x” when left out',
      'a list of values, each one of: a, b; each “a” when left out',
      'a list of whole numbers, each at least 1 or text',
      'a record of at most 3 entries, each a whole number, at least 1',
    ]);
  });

  it('say a number that is a multiple of another, and a list that holds no item twice', () => {
    expect([
      wordsOf({ type: 'integer', minimum: 5, multipleOf: 5 }),
      wordsOf({ type: 'array', uniqueItems: true, items: { type: 'string' } }),
    ]).toEqual(['a whole number, at least 5, a multiple of 5', 'a list of text, no item twice']);
  });
});

describe('the alternatives of a schema in words', () => {
  it('say a field that may take several types, or one of a few schemas, as alternatives', () => {
    expect([
      wordsOf({ type: ['string', 'null'] }),
      wordsOf({ type: ['integer', 7] }),
      wordsOf({ anyOf: [{ type: 'integer' }, { type: 'string', format: 'date-time' }] }),
      wordsOf({ oneOf: [{ type: 'boolean' }, { enum: ['yes', 'no'] }] }),
      wordsOf({ anyOf: Array.from({ length: 5 }, () => ({ type: 'string' })) }),
      wordsOf({ anyOf: [], type: 'string' }),
      wordsOf({ properties: { a: { type: 'string' } } }),
      wordsOf({ items: { type: 'string' } }),
    ]).toEqual([
      'text or nothing',
      'a whole number',
      'a whole number or a date and time',
      'yes or no or one of: yes, no',
      'one of 5 kinds of value',
      'text',
      'a record with: a (text, optional)',
      'a list of text',
    ]);
  });
});

describe('a record in words', () => {
  it('says the fields of a record one level down, each with its words, and a record beneath that as a record', () => {
    expect(
      wordsOf({
        type: 'object',
        required: ['days', 'owner'],
        properties: {
          days: { type: 'integer', minimum: 1, description: 'Days so far' },
          owner: { type: 'object', properties: { name: { type: 'string' } } },
          note: { type: 'string' },
        },
      }),
    ).toBe('a record with: days (Days so far; a whole number, at least 1), owner (a record), note (text, optional)');
    expect(wordsOf({ type: 'object' })).toBe('a record');
    expect(
      wordsOf({
        type: 'array',
        items: { type: 'object', required: ['campaign'], properties: { campaign: { type: 'string' } } },
      }),
    ).toBe('a list of records with: campaign (text)');
    expect(
      wordsOf({
        type: 'object',
        properties: Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`f${index}`, {}])),
      }),
    ).toMatch(/f11 \(any value, optional\), and 2 more$/u);
  });
});

describe('the references of a schema', () => {
  it('are read within the document, by $defs, definitions or the root', () => {
    const properties: Readonly<Record<string, Schema.JsonObject>> = {
      tag: { $ref: '#/$defs/tag' },
      named: { $ref: '#/$defs/tag', description: 'Its own words' },
      older: { $ref: '#/definitions/a~1b' },
      missing: { $ref: '#/$defs/nowhere' },
      outside: { $ref: 'https://example.com/schema' },
      tree: { $ref: '#/$defs/tree' },
      self: { $ref: '#' },
      astray: { $ref: '#/$defs/tag/type/more' },
    };
    const root = {
      type: 'object',
      properties,
      $defs: {
        tag: { type: 'string', minLength: 1, description: 'A tag' },
        tree: { type: 'array', items: { $ref: '#/$defs/tree' } },
      },
      definitions: { 'a/b': { type: 'boolean' } },
    };

    expect(Object.values(properties).map((property) => wordsOf(property, root))).toEqual([
      'text, at least 1 character',
      'text, at least 1 character',
      'yes or no',
      'any value',
      'any value',
      'a list of lists of lists of lists of lists of any values',
      'a record with: tag (A tag; text, at least 1 character, optional), named (Its own words; text, at least 1 character, optional), older (yes or no, optional), missing (any value, optional), outside (any value, optional), tree (a list of lists of lists of lists of any values, optional), self (a record, optional), astray (any value, optional)',
      'any value',
    ]);
  });
});

describe('the examples of a field', () => {
  it('are said in words, unless its description gives one already', () => {
    expect([
      examplesWordsOf(['April 2026', 7], 'The month to report on'),
      examplesWordsOf(['April 2026'], 'The month, such as April 2026'),
      examplesWordsOf([], 'The month'),
      examplesWordsOf(['April 2026', 'May'], 'The month as in April 2026'),
      examplesWordsOf(['May'], 'A month after Mayday'),
      examplesWordsOf([''], 'A month'),
    ]).toEqual([['such as “April 2026” or 7'], [], [], [], ['such as “May”'], ['such as “”']]);
  });
});

describe('the description of a field', () => {
  it("is the author's, as it is, on one line and cut at 300 characters", () => {
    const long = '😀'.repeat(301);

    expect([
      descriptionOf({ description: 'The brief to review' }),
      descriptionOf({ description: ' The brief\n  to review. \n' }),
      descriptionOf({ description: '  ' }),
      descriptionOf({}),
      descriptionOf({ description: long }),
    ]).toEqual(['The brief to review', 'The brief to review.', undefined, undefined, `${'😀'.repeat(300)}…`]);
  });
});
