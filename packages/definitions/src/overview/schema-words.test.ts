import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostFieldDescriptionCharacters, schemaBlocks, type OverviewBlock, type Phrases } from '../index.ts';

function plain(phrases: Phrases): string {
  return phrases
    .map((phrase) => (typeof phrase === 'string' ? phrase : `**${Object.values(phrase).join('')}**`))
    .join('');
}

function shown(block: OverviewBlock): unknown {
  if (block.kind === 'fields') {
    return Object.fromEntries(
      block.rows.map(({ name, required, words }) => [name, `${required ? '!' : ''}${plain(words)}`]),
    );
  }
  return block.kind === 'paragraph' ? plain(block.phrases) : block;
}

function blocksOf(schema?: Schema.JsonObject): readonly unknown[] {
  return schemaBlocks(schema, 'Nothing is said of it.').map((block) => shown(block));
}

function wordsOf(field: Schema.JsonObject): string {
  const [block] = schemaBlocks({ type: 'object', properties: { field } }, '');
  return block?.kind === 'fields' ? plain(block.rows[0]?.words ?? []) : '';
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
      'Text.',
      'A date and time.',
      'An email address.',
      'Text in the form the schema calls phone.',
      'A whole number.',
      'A number.',
      'Yes or no.',
      'Nothing.',
      'Any value.',
      'Any value.',
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
      'One of: draft, sent, 3, null.',
      'One of: v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, and 2 more.',
      'Exactly approve.',
      'Exactly null.',
      'Text.',
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
      'A list of text.',
      'A list of dates and times.',
      'A list of numbers.',
      'A list of yes-or-no values.',
      'A list of empty values.',
      'A list of lists of whole numbers.',
      'A list of records.',
      'A list of values, each one of: a, b.',
      'A list of values, each exactly 1.',
      'A list of any values.',
      'A list of whole numbers or text.',
      'A list of values of 5 kinds.',
      'A list.',
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
      'A list of 1 to 10 text values, each at most 200 characters.',
      'A list of at most 3 whole numbers, each from 1 to 50.',
      'A list of numbers, each more than 0, less than 1.',
      'A list of text, each at least 1 character, “x” when left out.',
      'A list of values, each one of: a, b; each “a” when left out.',
      'A list of whole numbers, each at least 1 or text.',
      'A record of at most 3 entries, each a whole number, at least 1.',
    ]);
  });

  it('say a number that is a multiple of another, and a list that holds no item twice', () => {
    expect([
      wordsOf({ type: 'integer', minimum: 5, multipleOf: 5 }),
      wordsOf({ type: 'array', uniqueItems: true, items: { type: 'string' } }),
    ]).toEqual(['A whole number, at least 5, a multiple of 5.', 'A list of text, no item twice.']);
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
      'Text or nothing.',
      'A whole number.',
      'A whole number or a date and time.',
      'Yes or no or one of: yes, no.',
      'One of 5 kinds of value.',
      'Text.',
      'A record with: **a** (text, optional).',
      'A list of text.',
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
    ).toBe(
      'A record with: **days** (Days so far; a whole number, at least 1), **owner** (a record), **note** (text, optional).',
    );
    expect(wordsOf({ type: 'object' })).toBe('A record.');
    expect(
      wordsOf({
        type: 'array',
        items: { type: 'object', required: ['campaign'], properties: { campaign: { type: 'string' } } },
      }),
    ).toBe('A list of records with: **campaign** (text).');
    expect(
      wordsOf({
        type: 'object',
        properties: Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`f${index}`, {}])),
      }),
    ).toMatch(/\*\*f11\*\* \(any value, optional\), and 2 more\.$/u);
  });
});

describe('the references of a schema', () => {
  it('are read within the document, by $defs, definitions or the root', () => {
    const root = {
      type: 'object',
      properties: {
        tag: { $ref: '#/$defs/tag' },
        named: { $ref: '#/$defs/tag', description: 'Its own words' },
        older: { $ref: '#/definitions/a~1b' },
        missing: { $ref: '#/$defs/nowhere' },
        outside: { $ref: 'https://example.com/schema' },
        tree: { $ref: '#/$defs/tree' },
        self: { $ref: '#' },
        astray: { $ref: '#/$defs/tag/type/more' },
      },
      $defs: {
        tag: { type: 'string', minLength: 1, description: 'A tag' },
        tree: { type: 'array', items: { $ref: '#/$defs/tree' } },
      },
      definitions: { 'a/b': { type: 'boolean' } },
    };

    expect(blocksOf(root)).toEqual([
      {
        tag: 'A tag. Text, at least 1 character.',
        named: 'Its own words. Text, at least 1 character.',
        older: 'Yes or no.',
        missing: 'Any value.',
        outside: 'Any value.',
        tree: 'A list of lists of lists of lists of any values.',
        astray: 'Any value.',
        self: 'A record with: **tag** (A tag; text, at least 1 character, optional), **named** (Its own words; text, at least 1 character, optional), **older** (yes or no, optional), **missing** (any value, optional), **outside** (any value, optional), **tree** (a list of lists of lists of any values, optional), **self** (a record, optional), **astray** (any value, optional).',
      },
    ]);
  });
});

describe('the examples of a field', () => {
  it('are said in words after its rules, unless its description gives one already', () => {
    expect([
      wordsOf({ type: 'string', minLength: 6, description: 'The month to report on', examples: ['April 2026', 7] }),
      wordsOf({ type: 'string', description: 'The month, such as April 2026', examples: ['April 2026'] }),
      wordsOf({ type: 'string', examples: [] }),
      wordsOf({ type: 'string', description: 'The month as in April 2026', examples: ['April 2026', 'May'] }),
      wordsOf({ type: 'string', description: 'A month after Mayday', examples: ['May'] }),
      wordsOf({ type: 'string', description: 'A month', examples: [''] }),
    ]).toEqual([
      'The month to report on. Text, at least 6 characters, such as “April 2026” or 7.',
      'The month, such as April 2026. Text.',
      'Text.',
      'The month as in April 2026. Text.',
      'A month after Mayday. Text, such as “May”.',
      'A month. Text, such as “”.',
    ]);
  });
});

describe('the description of a field', () => {
  it("is the author's, as it is, cut at its bound", () => {
    const long = '😀'.repeat(mostFieldDescriptionCharacters + 1);

    expect([
      wordsOf({ type: 'string', description: 'The brief to review' }),
      wordsOf({ type: 'string', description: 'The brief to review.' }),
      wordsOf({ type: 'string', description: '  ' }),
      wordsOf({ type: 'string', description: long }),
    ]).toEqual([
      'The brief to review. Text.',
      'The brief to review. Text.',
      'Text.',
      `${'😀'.repeat(mostFieldDescriptionCharacters)}… Text.`,
    ]);
  });
});

describe('the blocks of a schema', () => {
  it('are a table of its fields, in its order, required or not, and still the fields it does not describe', () => {
    expect(
      blocksOf({
        type: 'object',
        description: 'A campaign brief',
        required: ['brief'],
        properties: { brief: { type: 'string' }, notes: { type: 'string', description: 'Anything else' } },
      }),
    ).toEqual(['A campaign brief.', { brief: '!Text.', notes: 'Anything else. Text.' }]);
  });

  it('are a sentence for a schema that is no record of fields, and the words given for no schema at all', () => {
    expect([
      ...blocksOf({ type: 'array', items: { type: 'object', properties: { campaign: { type: 'string' } } } }),
      ...blocksOf({ type: 'object' }),
      ...blocksOf({ $ref: '#/$defs/row', $defs: { row: { type: 'object', properties: { id: { type: 'integer' } } } } }),
      ...blocksOf(),
    ]).toEqual([
      'A list of records with: **campaign** (text, optional).',
      'A record.',
      { id: 'A whole number.' },
      'Nothing is said of it.',
    ]);
  });
});
