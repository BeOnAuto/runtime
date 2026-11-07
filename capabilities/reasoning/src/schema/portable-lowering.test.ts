import { outputShapeOf } from '@on.auto/definitions';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { place } from '../schema-testing/answer-schemas.ts';
import { loweredSchema } from './portable-lowering.ts';

const boundInWords = 'Must be at least 1 character long; at most 64 characters long.';

const categoriesAsSent: Schema.JsonObject = {
  type: 'object',
  properties: {
    unit: { type: ['string', 'null'], description: boundInWords },
    values: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: boundInWords },
          value: { type: 'number' },
          low: { type: ['number', 'null'], description: 'The lowest the value may be; at most the value.' },
          high: { type: ['number', 'null'], description: 'The highest the value may be; at least the value.' },
        },
        required: ['name', 'value', 'low', 'high'],
        additionalProperties: false,
      },
      description: 'Must be at least 1 item; at most 200 items.',
    },
  },
  required: ['unit', 'values'],
  additionalProperties: false,
};

const describedReference: Schema.JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['home'],
  $defs: { address: place },
  properties: { home: { $ref: '#/$defs/address', description: 'Where the person lives' } },
};

const pairsOfLeaves: Schema.JsonObject = {
  type: 'object',
  $defs: {
    pair: {
      type: 'object',
      properties: { a: { $ref: '#/$defs/leaf' }, b: { $ref: '#/$defs/leaf' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
    leaf: { type: 'boolean' },
  },
  properties: { first: { $ref: '#/$defs/pair' }, second: { $ref: '#/$defs/pair' } },
  required: ['first', 'second'],
  additionalProperties: false,
};

function sentOf(document: Schema.JsonObject): Schema.JsonObject {
  return loweredSchema(document).sent;
}

describe('the lowering of the categories shape', () => {
  it('sends every optional property as required and nullable, and every bound in words, as the design writes it out', () => {
    expect(sentOf(outputShapeOf('categories').schema)).toEqual(categoriesAsSent);
  });
});

describe('the lowering of a $ref with words beside it', () => {
  it('inlines the definition there, since OpenAI refuses keywords beside a $ref', () => {
    expect(sentOf(describedReference)).toEqual({
      type: 'object',
      properties: {
        home: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
          additionalProperties: false,
          description: 'Where the person lives.',
        },
      },
      required: ['home'],
      additionalProperties: false,
    });
  });

  it('adds the words beside the $ref after the description of the definition', () => {
    const document = {
      type: 'object',
      $defs: { code: { type: 'string', description: 'A code' } },
      properties: { tag: { $ref: '#/$defs/code', maxLength: 8 } },
      required: ['tag'],
      additionalProperties: false,
    };

    expect(sentOf(document)).toMatchObject({
      properties: { tag: { type: 'string', description: 'A code. Must be at most 8 characters long.' } },
    });
  });
});

describe('the lowering of objects', () => {
  it('closes an empty object that is closed, rather than sending one of any keys', () => {
    const document = {
      type: 'object',
      additionalProperties: false,
      properties: { meta: { type: 'object', additionalProperties: false } },
    };

    expect(sentOf(document)).toMatchObject({
      properties: { meta: { type: ['object', 'null'], properties: {}, required: [], additionalProperties: false } },
    });
  });

  it('types properties with no type as an object, and wraps a root that is not one', () => {
    expect(
      sentOf({ properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }),
    ).toMatchObject({
      properties: { value: { type: 'object', required: ['a'] } },
      required: ['value'],
    });
  });
});

describe('the lowering of a map', () => {
  it('writes it as a list of entries, with the enum of its keys on the key', () => {
    const document = {
      type: 'object',
      propertyNames: { enum: ['low', 'high'] },
      additionalProperties: { type: 'number' },
    };

    expect(sentOf(document)).toMatchObject({
      properties: {
        value: {
          type: 'array',
          items: {
            properties: { key: { type: 'string', enum: ['low', 'high'] }, value: { type: 'number' } },
            required: ['key', 'value'],
            additionalProperties: false,
          },
          description: 'Each entry is one key and its value, each key once.',
        },
      },
    });
  });
});

describe('the lowering of choices and definitions', () => {
  it('nulls an optional choice among its choices, keeping its words, and an optional $ref beside null', () => {
    const document = {
      type: 'object',
      $defs: { place },
      properties: {
        contact: { anyOf: [{ type: 'string' }, { type: 'integer' }], description: 'How to reach them' },
        home: { $ref: '#/$defs/place' },
      },
      additionalProperties: false,
    };

    expect(sentOf(document)).toMatchObject({
      properties: {
        contact: {
          anyOf: [{ type: 'string' }, { type: 'integer' }, { type: 'null' }],
          description: 'How to reach them.',
        },
        home: { anyOf: [{ $ref: '#/$defs/place' }, { type: 'null' }] },
      },
      required: ['contact', 'home'],
    });
  });

  it('sends each definition once, however often the definitions that use it do', () => {
    expect(sentOf(pairsOfLeaves)['$defs']).toEqual({
      pair: {
        type: 'object',
        properties: { a: { $ref: '#/$defs/leaf' }, b: { $ref: '#/$defs/leaf' } },
        required: ['a', 'b'],
        additionalProperties: false,
      },
      leaf: { type: 'boolean' },
    });
  });

  it('types an enum with no type by the kinds of its values', () => {
    const document = {
      type: 'object',
      properties: { flag: { enum: [true, false] }, nothing: { const: null } },
      required: ['flag', 'nothing'],
      additionalProperties: false,
    };

    expect(sentOf(document)).toMatchObject({
      properties: { flag: { type: 'boolean' }, nothing: { type: 'null', enum: [null] } },
    });
  });
});
