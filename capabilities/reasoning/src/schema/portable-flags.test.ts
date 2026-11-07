import type { SchemaIssue } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { compileAnswerSchema } from './answer-schema.ts';
import { portableFormOf } from './portable-schema.ts';

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
