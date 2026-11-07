import type { SchemaIssue } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { decisionSchema, scoresSchema } from '../schema-testing/answer-schemas.ts';
import { compileAnswerSchema, type AnswerSchema } from './answer-schema.ts';
import { loweredSchema } from './portable-lowering.ts';
import { roundTripIssues, witnessOf, writtenFormOf } from './schema-round-trip.ts';

function compiled(document: Schema.JsonObject): AnswerSchema {
  return Result.getOrThrow(compileAnswerSchema(document));
}

function isObject(value: Schema.Json | undefined): value is Schema.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function levelsOf(value: Schema.Json | undefined): number {
  return isObject(value) ? 1 + levelsOf(value['child']) : 0;
}

function twice(detail: string): readonly SchemaIssue[] {
  return [
    { pointer: '', detail },
    { pointer: '', detail },
  ];
}

const named: Schema.JsonObject = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false,
};

const stricter: Schema.JsonObject = {
  type: 'object',
  properties: { name: { type: 'string' }, age: { type: 'integer' } },
  required: ['name', 'age'],
  additionalProperties: false,
};

const unnamed: Schema.JsonObject = { type: 'object', required: ['id'], properties: { name: { type: 'string' } } };

const contradictory: Schema.JsonObject = {
  type: 'object',
  properties: { code: { type: 'string', minLength: 5, maxLength: 2 } },
  required: ['code'],
  additionalProperties: false,
};

const tree: Schema.JsonObject = {
  $defs: { node: { type: 'object', properties: { child: { $ref: '#/$defs/node' } } } },
  $ref: '#/$defs/node',
};

const noWitness = 'no answer this schema accepts could be made to test its portable form with';

const notKept =
  'an answer this schema accepts does not keep its meaning when written in the portable form and read back';

const uncompiled =
  'the portable form cannot be checked at "/type": Expected one of null, boolean, object, array, number, string, integer, or a non-empty list of them';

const witnesses: readonly (readonly [string, Schema.JsonObject, Schema.Json])[] = [
  ['a format', { type: 'string', format: 'email' }, 'name@example.com'],
  ['a length', { type: 'string', minLength: 3 }, 'xxx'],
  ['no length at all', { type: 'string', maxLength: 0 }, ''],
  ['a bound it must pass', { type: 'integer', exclusiveMinimum: 4 }, 5],
  ['a highest value', { type: 'number', maximum: -5 }, -6],
  ['a range', { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 }, 0.5],
  ['a range of whole numbers', { type: 'integer', minimum: 0, maximum: 1 }, 1],
  ['a multiple', { type: 'integer', minimum: 7, multipleOf: 5 }, 10],
  ['no bound', { type: 'number' }, 0],
  ['a truth', { type: 'boolean' }, false],
  ['a null', { type: ['null'] }, null],
  ['a value of any type', {}, null],
  ['an enum', { enum: ['low', 'high'] }, 'low'],
  ['a constant', { const: 7 }, 7],
  ['a first choice of any type', { anyOf: [true, { type: 'string' }] }, null],
  ['a first choice', { type: 'string', oneOf: [{ minLength: 2 }, { maxLength: 0 }] }, 'xx'],
  [
    'a map with named keys',
    {
      type: 'object',
      propertyNames: { enum: ['low', 'high'] },
      minProperties: 2,
      additionalProperties: { type: 'number' },
    },
    { low: 0, high: 0 },
  ],
  ['a map', { type: 'object', additionalProperties: { type: 'boolean' } }, { k0: false }],
  [
    'a map whose keys have a format',
    { type: 'object', propertyNames: { format: 'date' }, additionalProperties: { type: 'boolean' } },
    { '2026-04-01': false },
  ],
  ['a list', { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 }, ['x', 'x']],
  ['an empty list', { type: 'array', maxItems: 0 }, []],
  ['required names with no schema', unnamed, { id: 'x' }],
];

describe('the round trip of a schema through the form it is lowered to', () => {
  it('holds', () => {
    expect(roundTripIssues(compiled(decisionSchema), loweredSchema(decisionSchema).sent)).toEqual([]);
  });
});

describe('the round trip of a schema through a portable form that cannot carry it', () => {
  it('fails when the form cannot be compiled to check what is written in it', () => {
    expect(roundTripIssues(compiled(named), { type: 'banana' })).toEqual([{ pointer: '', detail: uncompiled }]);
  });

  it('fails when the form refuses an answer written in it, or the answer does not read back', () => {
    expect([
      roundTripIssues(compiled(named), stricter),
      roundTripIssues(compiled(unnamed), loweredSchema(unnamed).sent),
    ]).toEqual([twice(notKept), twice(notKept)]);
  });

  it('fails when no answer the schema accepts can be made', () => {
    expect(roundTripIssues(compiled(contradictory), loweredSchema(contradictory).sent)).toEqual(twice(noWitness));
  });
});

describe('the answer a round trip makes to test a schema with', () => {
  it.each(witnesses)('is a value of %s', (_name, document, value) => {
    expect(witnessOf(document, false)).toEqual(value);
  });

  it('fills every optional property when asked to, and stops making values twelve levels down', () => {
    expect([witnessOf(tree, false), levelsOf(witnessOf(tree, true))]).toEqual([{}, 13]);
  });
});

describe('an answer written in the portable form, as a model would write it', () => {
  it('has nulls for absent optional properties, entries for maps, the first choice that fits, and a wrapper', () => {
    expect([
      writtenFormOf(scoresSchema, { scores: { a: 1 }, winner: 'a' }),
      writtenFormOf(decisionSchema, { verdict: { kind: 'reject', reason: 'No' } }),
      writtenFormOf(decisionSchema, { verdict: 'neither' }),
      writtenFormOf({ type: 'array', items: { type: 'string' } }, ['a']),
    ]).toEqual([
      { scores: [{ key: 'a', value: 1 }], winner: 'a' },
      { verdict: { kind: 'reject', reason: 'No' }, reviewer_note: null },
      { verdict: 'neither', reviewer_note: null },
      { value: ['a'] },
    ]);
  });
});
