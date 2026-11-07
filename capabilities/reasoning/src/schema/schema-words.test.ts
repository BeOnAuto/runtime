import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { loweredSchema } from './portable-lowering.ts';

const everyBound: Schema.JsonObject = {
  type: 'object',
  minProperties: 1,
  properties: {
    share: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, multipleOf: 0.01, description: 'The share.' },
    tags: { type: 'array', items: { type: 'string', format: 'uuid' }, uniqueItems: true, minItems: 1 },
    code: { type: 'string', minLength: 1, maxLength: 1, description: '  ' },
  },
  required: ['share', 'tags', 'code'],
  additionalProperties: false,
};

const countedMap: Schema.JsonObject = {
  type: 'object',
  properties: {
    scores: {
      type: ['object', 'null'],
      description: 'Each score',
      minProperties: 1,
      maxProperties: 3,
      propertyNames: { format: 'date' },
      additionalProperties: { type: 'integer' },
    },
  },
  required: ['scores'],
  additionalProperties: false,
};

describe('the words of the rules the portable form cannot send', () => {
  it('say every bound, a uniqueness and a format, after the description written', () => {
    expect(loweredSchema(everyBound).sent).toEqual({
      type: 'object',
      properties: {
        share: { type: 'number', description: 'The share. Must be more than 0; less than 1; a multiple of 0.01.' },
        tags: {
          type: 'array',
          items: { type: 'string', description: 'Must be a UUID such as 0f8fad5b-d9cb-469f-a165-70867728950e.' },
          description: 'Must be at least 1 item; without any item repeated.',
        },
        code: { type: 'string', description: 'Must be at least 1 character long; at most 1 character long.' },
      },
      required: ['share', 'tags', 'code'],
      additionalProperties: false,
      description: 'Must be an object of at least 1 property.',
    });
  });

  it('say the rules of the keys of a map, and how many entries it holds', () => {
    expect(loweredSchema(countedMap).sent).toMatchObject({
      properties: {
        scores: {
          type: ['array', 'null'],
          items: { properties: { key: { type: 'string', description: 'Must be a date such as 2026-04-01.' } } },
          description:
            'Each score. Each entry is one key and its value, each key once. Must be at least 1 entry; at most 3 entries.',
        },
      },
    });
  });
});
