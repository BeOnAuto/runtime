import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { compileJsonSchema, type CompiledSchema } from './json-schema.ts';

const asAnInput = { what: 'input', nesting: 64 };

function compiled(document: Schema.JsonObject): CompiledSchema {
  return Result.getOrThrow(compileJsonSchema(document, asAnInput));
}

function issuesOf(document: Schema.JsonObject, value: unknown): unknown {
  return compiled(document).issuesOf(value);
}

function bound(keywords: Schema.JsonObject) {
  return { rule: 'bound', keywords };
}

const bounds: readonly (readonly [Schema.JsonObject, Schema.Json, Schema.JsonObject])[] = [
  [{ type: 'string', minLength: 6 }, 'April', { minLength: 6 }],
  [{ type: 'string', minLength: 1 }, '', { minLength: 1 }],
  [{ type: 'string', maxLength: 3 }, 'abcd', { maxLength: 3 }],
  [{ type: 'number', minimum: 1 }, 0, { minimum: 1 }],
  [{ type: 'number', maximum: 100 }, 101, { maximum: 100 }],
  [{ type: 'number', exclusiveMinimum: 0 }, 0, { exclusiveMinimum: 0 }],
  [{ type: 'number', exclusiveMaximum: 1 }, 1, { exclusiveMaximum: 1 }],
  [{ type: 'number', multipleOf: 0.5 }, 0.3, { multipleOf: 0.5 }],
  [{ type: 'array', minItems: 2 }, ['a'], { minItems: 2 }],
  [{ type: 'array', maxItems: 1 }, ['a', 'b'], { maxItems: 1 }],
  [{ type: 'array', uniqueItems: true }, ['a', 'a'], { uniqueItems: true }],
  [{ type: 'object', minProperties: 1 }, {}, { minProperties: 1 }],
  [{ type: 'object', maxProperties: 1 }, { a: 1, b: 2 }, { maxProperties: 1 }],
];

describe('the issues of a value that breaks a bound of its schema', () => {
  it.each(bounds)(
    'names the keyword of %j with its value, beside the words of the validator',
    (schema, value, keywords) => {
      const [issue] = compiled(schema).issuesOf(value);

      expect(issue).toMatchObject({ pointer: '', breach: bound(keywords) });
      expect(compiled(schema).validate(value)).toEqual(Result.fail([{ pointer: '', detail: String(issue?.detail) }]));
    },
  );

  it('names the bound of a field where the field is, and of a name the schema bounds where the name is, as a name', () => {
    expect(
      issuesOf(
        {
          type: 'object',
          properties: { month: { type: 'string', minLength: 6 }, names: { propertyNames: { maxLength: 2 } } },
        },
        { month: 'May', names: { long: 1 } },
      ),
    ).toEqual([
      { pointer: '/month', detail: 'Expected a string with at least 6 code points', breach: bound({ minLength: 6 }) },
      {
        pointer: '/names/long',
        detail: 'Expected a string with at most 2 code points',
        breach: bound({ maxLength: 2 }),
        ofTheName: true,
      },
    ]);
  });
});

describe('the issues of a value of another kind than its schema allows', () => {
  it('say the value is of another kind, for a type, a choice, a whole number and the branches of anyOf', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        status: { enum: ['draft', 'sent'] },
        count: { type: 'integer' },
        either: { anyOf: [{ type: 'string', minLength: 3 }, { type: 'integer' }] },
      },
    };

    expect(issuesOf(schema, { name: 1, status: 'gone', count: 1.5, either: 'ab' })).toEqual([
      { pointer: '/name', detail: 'Expected string', breach: { rule: 'kind' } },
      { pointer: '/status', detail: 'Expected "draft" | "sent"', breach: { rule: 'kind' } },
      { pointer: '/count', detail: 'Expected an integer', breach: { rule: 'kind' } },
      { pointer: '/either', detail: 'Expected a string with at least 3 code points', breach: bound({ minLength: 3 }) },
    ]);
  });
});

describe('the issues of a value whose fields or items do not fit the schema', () => {
  it('say a field or an item is missing, or is one the schema does not allow, where it is', () => {
    const schema = {
      type: 'object',
      required: ['month', 'pair'],
      additionalProperties: false,
      properties: {
        month: { type: 'string' },
        pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }], minItems: 2, items: false },
      },
    };

    expect(issuesOf(schema, { pair: ['a'], extra: 1 })).toEqual([
      { pointer: '/extra', detail: 'Expected no excess property', breach: { rule: 'unexpected' } },
      { pointer: '/month', detail: 'Missing key', breach: { rule: 'missing' } },
      { pointer: '/pair/1', detail: 'Missing key', breach: { rule: 'missing' } },
    ]);
    expect(issuesOf(schema, { month: 'May', pair: ['a', 1, 2] })).toEqual([
      { pointer: '/pair/2', detail: 'Expected no excess property', breach: { rule: 'unexpected' } },
    ]);
  });

  it('say a value is one the schema does not allow where it allows none, in a closed empty object or by not', () => {
    const schema = {
      type: 'object',
      properties: { empty: { type: 'object', additionalProperties: false }, legacy: { not: {} } },
    };

    expect(issuesOf(schema, { empty: { now: true }, legacy: 1 })).toEqual([
      { pointer: '/empty/now', detail: 'Expected never', breach: { rule: 'unexpected' } },
      { pointer: '/legacy', detail: 'Expected never', breach: { rule: 'unexpected' } },
    ]);
  });
});

describe('the issues no keyword of the schema names', () => {
  it('are the words of the validator alone, for a value two branches of oneOf take, and a value it cannot check', () => {
    const either = { oneOf: [{ type: 'string' }, { type: 'string', minLength: 1 }] };

    expect([issuesOf(either, 'a'), issuesOf(either, new Date(0))]).toEqual([
      [{ pointer: '', detail: 'Expected exactly one member to match' }],
      [{ pointer: '', detail: 'The input is not JSON' }],
    ]);
  });

  it('are none for a value the schema takes', () => {
    expect(issuesOf({ type: 'string' }, 'April 2026')).toEqual([]);
  });
});
