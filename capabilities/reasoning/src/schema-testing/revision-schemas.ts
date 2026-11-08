import type { Schema } from 'effect';

import { joined } from '../schema/schema-definitions.ts';
import { invoiceSchema, place, ticketSchema, withOptionalStrings, type AnswerSchemaCase } from './answer-schemas.ts';

const sixOptional = withOptionalStrings('city', ['line1', 'line2', 'region', 'postcode', 'country', 'note']);

const eightOptional = withOptionalStrings('name', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);

function nested(levels: number): Schema.JsonObject {
  return levels === 0
    ? { type: 'string' }
    : { type: 'object', additionalProperties: false, required: ['next'], properties: { next: nested(levels - 1) } };
}

export const definitionUsedTwice: Schema.JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['billing', 'shipping'],
  $defs: { address: sixOptional },
  properties: { billing: { $ref: '#/$defs/address' }, shipping: { $ref: '#/$defs/address' } },
};

export const sixteenAfterInlining: Schema.JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['first', 'second'],
  $defs: { profile: eightOptional },
  properties: { first: { $ref: '#/$defs/profile' }, second: { $ref: '#/$defs/profile' } },
};

export const treeSchema: Schema.JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['root'],
  $defs: {
    node: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/$defs/node' } } },
    },
  },
  properties: { root: { $ref: '#/$defs/node' } },
};

const contactChoice: Schema.JsonObject = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['email'],
      properties: { email: { type: 'string', format: 'email' } },
    },
    { type: 'object', additionalProperties: false, required: ['phone'], properties: { phone: { type: 'string' } } },
  ],
};

function closedWith(properties: Schema.JsonObject, required: readonly string[]): Schema.JsonObject {
  return { type: 'object', additionalProperties: false, required, properties };
}

export const revisionSchemas: readonly AnswerSchemaCase[] = [
  { name: 'the same definition used 2 times (12 after inlining)', document: definitionUsedTwice, issues: [] },
  { name: 'exactly 16 after inlining (8 optional fields, used twice)', document: sixteenAfterInlining, issues: [] },
  {
    name: 'optional $ref, and a $ref with a bound beside it',
    document: joined(
      closedWith(
        {
          home: { $ref: '#/$defs/place', description: 'Home' },
          work: { $ref: '#/$defs/place' },
          tag: { $ref: '#/$defs/code', maxLength: 8 },
        },
        ['home'],
      ),
      { $defs: { place, code: { type: 'string' } } },
    ),
    issues: [],
  },
  {
    name: 'draft-07 definitions',
    document: joined(closedWith({ home: { $ref: '#/definitions/place' } }, ['home']), {
      $schema: 'http://json-schema.org/draft-07/schema',
      definitions: { place },
    }),
    issues: [],
  },
  {
    name: 'a tree (recursion)',
    document: treeSchema,
    issues: [{ pointer: '/properties/root', detail: 'the definition #/$defs/node, which refers to itself' }],
  },
  {
    name: 'allOf',
    document: closedWith({ a: { allOf: [{ type: 'string' }, { maxLength: 3 }] } }, ['a']),
    issues: [
      { pointer: '/properties/a/allOf', detail: 'allOf, which strict structured outputs refuse' },
      { pointer: '/properties/a', detail: 'a value of any type' },
    ],
  },
  {
    name: 'a tuple (prefixItems)',
    document: closedWith(
      { point: { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }], items: false } },
      ['point'],
    ),
    issues: [
      { pointer: '/properties/point/prefixItems', detail: 'a list of fixed positions (prefixItems)' },
      { pointer: '/properties/point/items', detail: 'a schema no value matches' },
    ],
  },
  {
    name: 'oneOf of whole objects beside a shared type',
    document: closedWith({ contact: contactChoice }, ['contact']),
    issues: [],
  },
  {
    name: 'eleven levels of objects',
    document: closedWith({ next: nested(10) }, ['next']),
    issues: [
      {
        pointer: '',
        detail: '11 levels of objects (most 10)',
        rewrite: 'nest fewer levels of objects, or split the answer',
      },
    ],
  },
  {
    name: 'enum of mixed kinds, optional',
    document: closedWith({ level: { enum: ['low', 2, null] }, mood: { enum: ['calm', 'busy'] } }, []),
    issues: [{ pointer: '/properties/level', detail: 'an enum that mixes kinds of value (string, number)' }],
  },
  {
    name: 'enum of one kind with null and no type, optional',
    document: closedWith({ level: { enum: ['low', 'high', null] }, rank: { enum: [1, 2.5] } }, []),
    issues: [],
  },
  {
    name: 'a map with a count and key rules',
    document: closedWith(
      {
        scores: {
          type: 'object',
          minProperties: 1,
          maxProperties: 3,
          propertyNames: { maxLength: 12 },
          additionalProperties: { type: 'integer', minimum: 0 },
        },
      },
      ['scores'],
    ),
    issues: [],
  },
  {
    name: 'properties beside $ref',
    document: joined(
      closedWith({ home: { $ref: '#/$defs/place', properties: { zip: { type: 'string' } } } }, ['home']),
      { $defs: { place } },
    ),
    issues: [{ pointer: '/properties/home', detail: 'keywords beside $ref: properties' }],
  },
  { name: 'a value of any type at the root', document: {}, issues: [{ pointer: '', detail: 'a value of any type' }] },
  {
    name: 'an open object with properties',
    document: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    issues: [],
  },
  { name: 'ticket with a tight bound', document: ticketSchema, issues: [] },
  { name: 'invoice', document: invoiceSchema, issues: [] },
];
