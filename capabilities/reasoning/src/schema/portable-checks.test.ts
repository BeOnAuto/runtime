import type { SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { budgetOf, overBudget, portableBudget, portableIssues, type Budget } from './portable-checks.ts';

const closed: Schema.JsonObject = { type: 'object', properties: {}, required: [], additionalProperties: false };

const keptToTheSubset: Schema.JsonObject = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'A name' },
    home: { $ref: '#/$defs/place' },
    tags: { anyOf: [{ type: 'array', items: { type: 'string', enum: ['a'] } }, { type: 'null' }] },
  },
  required: ['name', 'home', 'tags'],
  additionalProperties: false,
  $defs: { place: closed },
};

const brokenEveryWay: Schema.JsonObject = {
  type: ['object', 'null'],
  properties: {
    extra: { type: 'string', maxLength: 3 },
    beside: { $ref: '#/$defs/place', description: 'Words' },
    missing: { $ref: '#/$defs/nowhere' },
    choice: { anyOf: [{ type: 'string' }], type: 'string' },
    untyped: {},
    open: { type: 'object', properties: { a: { type: 'string' } }, required: [] },
    bare: { type: 'object' },
    list: { type: 'array' },
    flag: true,
    nested: { type: 'string', $defs: {} },
  },
  required: ['extra'],
  additionalProperties: false,
  $defs: { place: { type: 'object' } },
};

const brokenRules: readonly SchemaIssue[] = [
  { pointer: '', detail: 'a root that is not one object' },
  { pointer: '', detail: 'an object whose required list is not every property' },
  { pointer: '/properties/extra/maxLength', detail: 'maxLength is not a keyword of the portable form' },
  { pointer: '/properties/beside', detail: 'a $ref with keywords beside it' },
  { pointer: '/properties/missing', detail: 'a $ref to no definition sent' },
  { pointer: '/properties/choice', detail: 'an anyOf with keywords beside it' },
  { pointer: '/properties/untyped', detail: 'a schema with no type' },
  { pointer: '/properties/open', detail: 'an object whose required list is not every property' },
  { pointer: '/properties/open', detail: 'an object that is not closed' },
  { pointer: '/properties/bare', detail: 'an object with no properties' },
  { pointer: '/properties/bare', detail: 'an object that is not closed' },
  { pointer: '/properties/list', detail: 'a list with no item schema' },
  { pointer: '/properties/flag', detail: 'a schema that is not an object' },
  { pointer: '/properties/nested/$defs', detail: '$defs is not a keyword of the portable form' },
  { pointer: '/$defs/place', detail: 'an object with no properties' },
  { pointer: '/$defs/place', detail: 'an object that is not closed' },
];

const pairsOfLeaves: Schema.JsonObject = {
  type: 'object',
  properties: {
    first: { $ref: '#/$defs/pair' },
    second: { $ref: '#/$defs/pair' },
    level: { type: 'string', enum: ['low', 'high'] },
    rank: { type: 'integer', enum: [1, 2] },
  },
  required: ['first', 'second', 'level', 'rank'],
  additionalProperties: false,
  $defs: {
    pair: {
      type: 'object',
      properties: { a: { type: ['string', 'null'] }, b: { anyOf: [{ $ref: '#/$defs/leaf' }, { type: 'null' }] } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
    leaf: closed,
  },
};

const tree: Schema.JsonObject = {
  type: 'object',
  properties: { root: { $ref: '#/$defs/node' } },
  required: ['root'],
  additionalProperties: false,
  $defs: {
    node: {
      type: 'object',
      properties: { children: { type: 'array', items: { $ref: '#/$defs/node' } } },
      required: ['children'],
      additionalProperties: false,
    },
  },
};

const overEveryMeasure: Budget = {
  unions: portableBudget.unions + 1,
  depth: portableBudget.depth + 1,
  properties: portableBudget.properties + 1,
  enumValues: portableBudget.enumValues + 1,
  characters: portableBudget.characters + 1,
};

describe('the checker of the portable subset', () => {
  it('finds nothing in a form that keeps to it', () => {
    expect(portableIssues(keptToTheSubset)).toEqual([]);
  });

  it('names every rule a form breaks, at its pointer', () => {
    expect(portableIssues(brokenEveryWay)).toEqual(brokenRules);
  });
});

describe('the budget of a portable form', () => {
  it('counts what each definition holds where it is used, and the levels of objects through them', () => {
    expect(budgetOf(pairsOfLeaves)).toEqual({ unions: 4, depth: 3, properties: 8, enumValues: 4, characters: 31 });
  });

  it('counts a definition that leads back to itself once, rather than without end', () => {
    expect(budgetOf(tree)).toEqual({ unions: 0, depth: 2, properties: 2, enumValues: 0, characters: 12 });
  });
});

describe('a measure over the portable budget', () => {
  it('is reported, and a measure at the budget is not', () => {
    expect([overBudget(portableBudget), overBudget(overEveryMeasure).map(({ detail }) => detail)]).toEqual([
      [],
      [
        'over the portable budget: 17 fields that may be null or are a choice of types, counted where each definition is used (most 16)',
        'over the portable budget: 11 levels of objects (most 10)',
        'over the portable budget: 5001 properties (most 5000)',
        'over the portable budget: 1001 enum values (most 1000)',
        'over the portable budget: 120001 characters of names and enum values (most 120000)',
      ],
    ]);
  });
});
