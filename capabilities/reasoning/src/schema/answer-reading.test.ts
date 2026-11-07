import { Option, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { OutputMode } from '../model/model-result.ts';
import { readBackAnswers, writtenSamples } from '../schema-testing/answer-samples.ts';
import { decisionSchema, jsonOutputOf, measuredSchemas } from '../schema-testing/answer-schemas.ts';
import { keptAnswerOf, portableAnswerOf, readBack, type Mismatch } from './answer-reading.ts';
import { compileAnswerSchema, type AnswerSchema } from './answer-schema.ts';

function compiled(document: Schema.JsonObject): AnswerSchema {
  return Result.getOrThrow(compileAnswerSchema(document));
}

function mismatchOf(document: Schema.JsonObject, written: Schema.Json): Mismatch {
  return Result.match(portableAnswerOf(compiled(document), written), {
    onSuccess: () => ({ issues: [], written: [] }),
    onFailure: (mismatch) => mismatch,
  });
}

const mapOfNumbers: Schema.JsonObject = { type: 'object', additionalProperties: { type: 'number', maximum: 10 } };

const listOfNames: Schema.JsonObject = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: { name: { type: 'string', maxLength: 3 } },
  },
};

const scoresThroughARef: Schema.JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['scores'],
  $defs: { scores: { type: 'object', additionalProperties: { type: 'integer', maximum: 10 } } },
  properties: { scores: { $ref: '#/$defs/scores' } },
};

const nullableEnums: Schema.JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: { level: { enum: ['low', 'high', null] }, rank: { enum: [1, 2.5] } },
};

const openObject: Schema.JsonObject = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };

const choiceOfNone: Schema.JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['at'],
  properties: { at: { anyOf: [false, { type: 'string' }] } },
};

const repeatedKeys = {
  scores: [
    { key: 'x', value: 1 },
    { key: 'x', value: 2 },
  ],
};

const repeatedKey = 'Expected each key once; "x" is given more than once';

const keyed = compiled({
  type: 'object',
  additionalProperties: false,
  properties: { key: { type: 'string', minLength: 3 } },
});

const unrecorded: { readonly output_mode?: OutputMode } = {};

describe('an answer written in the portable form, read back into the schema as written', () => {
  it.each(measuredSchemas.map((one) => [one.name, one] as const))(
    'is the answer the schema takes, its optional nulls left out and its maps whole again: %s',
    (name, one) => {
      expect(portableAnswerOf(jsonOutputOf(one).schema, writtenSamples[name])).toEqual(
        Result.succeed(readBackAnswers[name]),
      );
    },
  );
});

describe('an answer read back where null and absent cannot be told apart', () => {
  it('keeps the null of a property that allows null itself', () => {
    expect(portableAnswerOf(compiled(nullableEnums), { level: null, rank: null })).toEqual(
      Result.succeed({ level: null }),
    );
  });
});

describe('an answer read back into a root that is not one object, or an open object', () => {
  it('is unwrapped, taken unwrapped when the schema takes it so, and keeps the keys the schema allows beyond its own', () => {
    expect([
      portableAnswerOf(compiled(listOfNames), { value: [{ name: 'Rio' }] }),
      portableAnswerOf(compiled(listOfNames), [{ name: 'Rio' }]),
      portableAnswerOf(compiled(openObject), { name: 'Ada', nickname: 'A' }),
    ]).toEqual([
      Result.succeed([{ name: 'Rio' }]),
      Result.succeed([{ name: 'Rio' }]),
      Result.succeed({ name: 'Ada', nickname: 'A' }),
    ]);
  });
});

describe('an answer read back into a choice', () => {
  it('takes the first choice that fits the value read back', () => {
    const approved = {
      verdict: { kind: 'approve', limit: { amount: 80, currency: 'EUR' } },
      reviewer_note: 'Within the policy',
    };

    expect(portableAnswerOf(compiled(decisionSchema), approved)).toEqual(Result.succeed(approved));
  });
});

describe('the issues of an answer read back from the portable form', () => {
  it('are placed in the schema as written, and told at the pointers of what the model wrote', () => {
    const bobAndAlice = {
      value: [
        { key: 'bob', value: 3 },
        { key: 'alice', value: 12 },
      ],
    };
    const xAndY = {
      scores: [
        { key: 'x', value: 1 },
        { key: 'y', value: 11 },
      ],
    };
    const most10 = 'Expected a value less than or equal to 10';
    const most3 = 'Expected a string with at most 3 code points';

    expect([
      mismatchOf(mapOfNumbers, bobAndAlice),
      mismatchOf(listOfNames, { value: [{ name: 'Rio' }, { name: 'Tokyo' }] }),
      mismatchOf(scoresThroughARef, xAndY),
    ]).toEqual([
      { issues: [{ pointer: '/alice', detail: most10 }], written: [{ pointer: '/value/1/value', detail: most10 }] },
      { issues: [{ pointer: '/1/name', detail: most3 }], written: [{ pointer: '/value/1/name', detail: most3 }] },
      { issues: [{ pointer: '/scores/y', detail: most10 }], written: [{ pointer: '/scores/1/value', detail: most10 }] },
    ]);
  });
});

describe('the issues of an answer whose map or choices cannot be read', () => {
  it('name a key the model gave twice, keeping its first value', () => {
    expect([readBack(scoresThroughARef, repeatedKeys), mismatchOf(scoresThroughARef, repeatedKeys)]).toMatchObject([
      { value: { scores: { x: 1 } }, issues: [{ pointer: '/scores', detail: repeatedKey }] },
      { issues: [{ pointer: '/scores', detail: repeatedKey }], written: [{ pointer: '/scores', detail: repeatedKey }] },
    ]);
  });

  it('come from the answer as the model wrote it when its entries or its choices cannot be read', () => {
    expect([
      mismatchOf(mapOfNumbers, { value: [3, { key: 4, value: 1 }] }).issues,
      mismatchOf(choiceOfNone, { at: 7 }).issues,
    ]).toEqual([[{ pointer: '', detail: 'Expected object' }], [{ pointer: '/at', detail: 'Expected never | string' }]]);
  });

  it('keep a pointer the reading never reached below the deepest place it did', () => {
    expect(readBack(listOfNames, { value: [] }).writtenPointerOf('/0/name')).toBe('/value/0/name');
  });
});

describe('the kept answer of a call, read again by the mode its fact records', () => {
  it('reads back an answer the call asked for in the portable form, and takes any other as written', () => {
    expect([
      keptAnswerOf('{"key":null}', keyed, 'portable'),
      keptAnswerOf('{"key":"ab"}', keyed, 'portable'),
      keptAnswerOf('{"key":null}', keyed, 'described'),
      keptAnswerOf('```json\n{"key":"abc"}\n```', keyed, unrecorded.output_mode),
      keptAnswerOf('The key is abc', keyed, 'portable'),
    ]).toEqual([
      Option.some(Result.succeed({})),
      Option.some(Result.fail([{ pointer: '/key', detail: 'Expected a string with at least 3 code points' }])),
      Option.some(Result.fail([{ pointer: '/key', detail: 'Expected string' }])),
      Option.some(Result.succeed({ key: 'abc' })),
      Option.none(),
    ]);
  });
});
