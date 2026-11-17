import type { SchemaIssue } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { compileAnswerSchema } from './answer-schema.ts';
import { type Budget, budgetOf, overBudget, portableBudget, portableIssues } from './portable-checks.ts';
import { portableFormOf } from './portable-schema.ts';

const anyWords: unknown = expect.any(String);

function issuesOf(document: Schema.JsonObject): readonly SchemaIssue[] {
  const form = portableFormOf(Result.getOrThrow(compileAnswerSchema(document)));
  return form.portable ? [] : form.issues;
}

const constructs: readonly (readonly [string, Schema.JsonObject, readonly SchemaIssue[]])[] = [
  ['an object of any keys', { type: 'object' }, [{ pointer: '', detail: 'an object of any keys and values' }]],
  ['a list of any items', { type: 'array' }, [{ pointer: '', detail: 'a list whose items may be of any type' }]],
  [
    'properties of any value and of none, the first optional',
    { type: 'object', properties: { any: true, none: false }, required: ['none'], additionalProperties: false },
    [
      { pointer: '/properties/any', detail: 'a value of any type' },
      { pointer: '/properties/none', detail: 'a schema no value matches' },
    ],
  ],
  [
    'rules of the keys that cannot be put into words',
    { type: 'object', propertyNames: { anyOf: [{ maxLength: 2 }] }, additionalProperties: { type: 'string' } },
    [{ pointer: '/propertyNames', detail: 'rules of the keys that cannot be put into words: anyOf' }],
  ],
  [
    'definitions under both keywords',
    {
      type: 'object',
      $defs: { a: { type: 'string' } },
      definitions: { b: { type: 'string' } },
      properties: { a: { $ref: '#/$defs/a' } },
      required: ['a'],
      additionalProperties: false,
    },
    [{ pointer: '', detail: 'definitions under both $defs and definitions' }],
  ],
  [
    'an anyOf beside a type its choices do not share',
    {
      type: 'object',
      properties: { a: { type: 'string', anyOf: [{ type: 'number' }, true] } },
      additionalProperties: false,
    },
    [
      { pointer: '/properties/a', detail: 'anyOf beside type' },
      { pointer: '/properties/a/anyOf/1', detail: 'a value of any type' },
    ],
  ],
  [
    'a schema no answer can be made for',
    {
      type: 'object',
      properties: { code: { type: 'string', minLength: 5, maxLength: 2 } },
      required: ['code'],
      additionalProperties: false,
    },
    [{ pointer: '', detail: 'no answer this schema accepts could be made to test its portable form with' }],
  ],
];

describe('the constructs the portable form cannot carry', () => {
  it.each(constructs)('are reported where they are: %s', (_name, document, issues) => {
    expect(issuesOf(document)).toEqual(issues);
  });
});

describe('a type beside choices that hold only constants', () => {
  it('is shared by them, so the schema is portable', () => {
    const sized = {
      type: 'object',
      properties: { size: { type: 'string', oneOf: [{ const: 'small' }, { const: 'large' }] } },
      required: ['size'],
      additionalProperties: false,
    };

    expect(issuesOf(sized)).toEqual([]);
  });
});

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
  it('is reported with how to bring it within, and a measure at the budget is not', () => {
    expect([overBudget(portableBudget), overBudget(overEveryMeasure)]).toEqual([
      [],
      [
        {
          pointer: '',
          detail: anyWords,
          rewrite: 'make some of these fields required and of one type, or split the answer',
        },
        {
          pointer: '',
          detail: '11 levels of objects (most 10)',
          rewrite: 'nest fewer levels of objects, or split the answer',
        },
        { pointer: '', detail: '5001 properties (most 5000)', rewrite: 'split the answer' },
        {
          pointer: '',
          detail: '1001 enum values (most 1000)',
          rewrite: 'list fewer enum values, or split the answer',
        },
        {
          pointer: '',
          detail: '120001 characters of names and enum values (most 120000)',
          rewrite: 'use shorter names and enum values, or split the answer',
        },
      ],
    ]);
  });
});
