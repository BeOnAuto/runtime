import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { plainTextOf } from '../index.ts';
import { shapeNamed } from '../testing/index.ts';
import { answeredWords, enumerationWords, givenClause, givenWords, mostToldFields } from './field-sentences.ts';

const approval = {
  type: 'object',
  required: ['approver', 'label', 'draft'],
  properties: {
    approver: { type: 'string', description: 'Chat user id of the approver' },
    label: { type: 'string', description: 'The month, such as April 2026' },
    draft: { type: 'string', description: 'The draft report', maxLength: 6000 },
  },
};

function fieldsNamed(count: number, required: number) {
  const names = Array.from({ length: count }, (_, index) => `field_${index + 1}`);
  return {
    type: 'object',
    required: names.slice(0, required),
    properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
  };
}

describe('the fields a definition is given, told as a sentence', () => {
  it('are their meanings, listed as English lists them, without a serial comma where no meaning holds a comma', () => {
    expect([
      plainTextOf(givenClause(approval)),
      plainTextOf(
        givenWords({ type: 'object', properties: { month: { type: 'string', description: 'The month, as 2026-04' } } }),
      ),
    ]).toEqual(['It is given the approver, the month and the draft report', 'the month, as 2026-04']);
  });

  it(`are the required ones and the rest, under Details, past ${mostToldFields}`, () => {
    expect([
      plainTextOf(givenWords(fieldsNamed(mostToldFields, 0))),
      plainTextOf(givenWords(fieldsNamed(mostToldFields + 1, 2))),
      plainTextOf(givenWords(fieldsNamed(mostToldFields + 1, 0))),
      plainTextOf(givenWords(fieldsNamed(mostToldFields + 4, mostToldFields + 2))),
    ]).toEqual([
      'the field 1, the field 2, the field 3, the field 4, the field 5, the field 6, the field 7 and the field 8',
      'the field 1, the field 2, and the rest, under Details',
      'what Details lists',
      'the field 1, the field 2, the field 3, the field 4, the field 5, the field 6, the field 7, the field 8, and the rest, under Details',
    ]);
  });

  it('say the values a field takes, and that a field has a default', () => {
    expect(
      plainTextOf(
        givenWords({
          type: 'object',
          properties: {
            decision: { type: 'string', enum: ['approve', 'revise', 'skip'] },
            limit: { type: 'integer', default: 20 },
          },
        }),
      ),
    ).toBe('the decision, one of approve, revise and skip, and the limit, else its default');
  });
});

describe('the input a definition is given, where it has no fields', () => {
  it('is the input as its schema describes it, its values or its kind, or any input where it says nothing', () => {
    expect([
      givenWords(),
      givenWords({}),
      givenWords({ description: 'Free text' }),
      givenWords({ type: 'string' }),
      givenWords({ type: 'string', description: 'The text to read' }),
      givenWords({ type: 'string', description: 'Free text' }),
      givenWords({ type: 'string', enum: ['draft', 'final'] }),
      givenWords({ $ref: '#/$defs/text', $defs: { text: { type: 'string', description: 'The text to read' } } }),
    ]).toEqual([
      ['any input'],
      ['any input'],
      ['any input'],
      ['text'],
      ['the text to read'],
      ['text'],
      ['one of ', 'draft', ' and ', 'final'],
      ['the text to read'],
    ]);
  });
});

describe('the fields a definition answers with, told as a sentence', () => {
  it('say of a field that may be left out that it is there when there is one', () => {
    expect(
      plainTextOf(
        answeredWords({
          type: 'object',
          required: ['verdict'],
          properties: { verdict: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string' } },
        }),
      ),
    ).toBe('the verdict, one of approve and reject, and the note, when there is one');
  });

  it('read the fields of a schema its root refers to', () => {
    expect(
      plainTextOf(
        answeredWords({
          $ref: '#/$defs/window',
          $defs: {
            window: {
              type: 'object',
              required: ['start', 'end'],
              properties: { start: { $ref: '#/$defs/day' }, end: { type: 'string' } },
            },
            day: { type: 'string', description: 'The first day' },
          },
        }),
      ),
    ).toBe('the first day and the end');
  });

  it('are the shape the output declares, the values it takes, or what kind of value it is, for an output of no fields', () => {
    expect([
      answeredWords(undefined, shapeNamed('series')),
      answeredWords(shapeNamed('table').schema, shapeNamed('table')),
      answeredWords({ type: 'string', enum: ['yes', 'no'] }),
      answeredWords({ type: 'array', items: { type: 'object' } }),
      answeredWords(),
    ]).toEqual([
      ['a series over time'],
      ['rows under named columns'],
      ['one of ', 'yes', ' and ', 'no'],
      ['a list of records'],
      ['any value'],
    ]);
  });
});

describe('the values a field takes, in words', () => {
  it('are each value named, up to twelve, and how many more there are', () => {
    const months = Array.from({ length: 14 }, (_, index) => `m${index + 1}`);

    expect([
      plainTextOf(enumerationWords(['approve', 'reject'])),
      plainTextOf(enumerationWords([1, true, 'a, b'])),
      plainTextOf(enumerationWords(months)),
    ]).toEqual([
      'one of approve and reject',
      'one of 1, true, and a, b',
      'one of m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12 and 2 more',
    ]);
  });
});

function nestedLists(depth: number): Schema.JsonObject {
  return depth === 0 ? { type: 'string' } : { type: 'array', items: nestedLists(depth - 1) };
}

describe('what a definition answers with, for an output of no fields', () => {
  it('names what the value is, without its bounds', () => {
    expect(
      [
        { type: 'string', maxLength: 200 },
        { type: 'string', format: 'date' },
        { type: 'string', format: 'phone' },
        { type: 'integer', minimum: 1 },
        { type: 'number' },
        { type: 'boolean' },
        { type: ['string', 'null'] },
        { type: 'object', maxProperties: 3 },
        { properties: {} },
        {},
      ].map((schema: Schema.JsonObject) => plainTextOf(answeredWords(schema))),
    ).toEqual([
      'text',
      'a date',
      'text',
      'a whole number',
      'a number',
      'yes or no',
      'text or nothing',
      'a record',
      'a record',
      'any value',
    ]);
  });

  it('names a list by what each item is, or a list where it says nothing of them', () => {
    expect(
      [
        { type: 'array', items: { type: 'string', format: 'email' } },
        { type: 'array', maxItems: 4 },
        { items: { type: 'array', items: { type: 'integer' } } },
        { type: 'array', items: { $ref: '#/$defs/row' }, $defs: { row: { type: 'object' } } },
      ].map((schema: Schema.JsonObject) => plainTextOf(answeredWords(schema))),
    ).toEqual(['a list of email addresses', 'a list', 'a list of lists of whole numbers', 'a list of records']);
  });

  it('names a value nested past the depth it reads as any value', () => {
    expect(plainTextOf(answeredWords(nestedLists(12)))).toBe(`a list of ${'lists of '.repeat(8)}values`);
  });
});
