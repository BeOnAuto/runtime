import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SchemaIssue } from './json-bounds.ts';
import { compileJsonSchema, jsonSchemaLimits, type CompiledSchema } from './json-schema.ts';

const answerNesting = 128;

const asAnAnswer = { what: 'answer', nesting: answerNesting };

const verdict = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    score: { type: 'integer', minimum: 0, maximum: 10 },
    tags: { type: 'array', items: { enum: ['urgent', 'routine'] } },
  },
  required: ['answer', 'score', 'tags'],
  additionalProperties: false,
};

const tree = {
  $defs: {
    node: {
      type: 'object',
      properties: { children: { type: 'array', items: { $ref: '#/$defs/node' } } },
      required: ['children'],
    },
  },
  $ref: '#/$defs/node',
};

function compiled(document: unknown): CompiledSchema {
  return Result.getOrThrow(compileJsonSchema(document, asAnAnswer));
}

function answerIssues(schema: CompiledSchema, answer: unknown): readonly SchemaIssue[] {
  return Result.match(schema.validate(answer), { onSuccess: () => [], onFailure: (issues) => issues });
}

function nestedObjects(levels: number): Schema.Json {
  let value: Schema.Json = 'leaf';
  for (let level = 0; level < levels; level += 1) {
    value = { next: value };
  }
  return value;
}

function nestedChildren(levels: number): Schema.Json {
  let value: Schema.Json = [];
  for (let level = 0; level < levels; level += 1) {
    value = { children: [value] };
  }
  return value;
}

describe('an answer that matches the schema', () => {
  it('is returned unchanged', () => {
    const answer = { answer: 'yes', score: 7, tags: ['urgent'] };

    expect(compiled(verdict).validate(answer)).toEqual(Result.succeed(answer));
  });

  it('keeps the extra properties of an open object', () => {
    const open = compiled({ type: 'object', properties: { a: { type: 'string' } } });

    expect(open.validate({ a: 'x', b: 2 })).toEqual(Result.succeed({ a: 'x', b: 2 }));
  });

  it('is checked against recursive definitions and draft-07 definitions', () => {
    const draft = compiled({
      $schema: 'http://json-schema.org/draft-07/schema#',
      definitions: { name: { type: 'string' } },
      type: 'object',
      properties: { first: { $ref: '#/definitions/name' } },
      required: ['first'],
    });
    const undeclared = compiled({
      definitions: { name: { type: 'string' } },
      properties: { first: { $ref: '#/definitions/name' } },
    });

    expect(answerIssues(compiled(tree), { children: [{ children: [] }, { children: [{ children: 5 }] }] })).toEqual([
      { pointer: '/children/1/children/0/children', detail: 'Expected array' },
    ]);
    expect(answerIssues(draft, { first: 1 })).toEqual([{ pointer: '/first', detail: 'Expected name' }]);
    expect(answerIssues(undeclared, { first: 'Ada' })).toEqual([]);
  });

  it('keeps the document as written', () => {
    expect(compiled(verdict).document).toEqual(verdict);
  });
});

describe('an answer that does not match the schema', () => {
  it('is reported with a JSON pointer for every mismatch', () => {
    expect(answerIssues(compiled(verdict), { answer: 42, score: 11, tags: ['later'], extra: true })).toEqual([
      { pointer: '/extra', detail: 'Expected no excess property' },
      { pointer: '/answer', detail: 'Expected string' },
      { pointer: '/score', detail: 'Expected a value less than or equal to 10' },
      { pointer: '/tags/0', detail: 'Expected "urgent" | "routine"' },
    ]);
    expect(answerIssues(compiled(verdict), { answer: 'yes', tags: [] })).toEqual([
      { pointer: '/score', detail: 'Missing key' },
    ]);
  });

  it('is never quoted in an issue', () => {
    const issues = JSON.stringify(answerIssues(compiled(verdict), { answer: 'confidential text', score: -1, tags: 5 }));

    expect(issues).not.toContain('confidential');
    expect(issues).not.toContain('-1');
  });

  it('is reported with escaped pointer tokens', () => {
    const schema = compiled({
      properties: { 'a/b': { type: 'string' }, 'c~d': { type: 'string' } },
      required: ['a/b', 'c~d'],
    });

    expect(answerIssues(schema, { 'a/b': 1, 'c~d': 2 })).toEqual([
      { pointer: '/a~1b', detail: 'Expected string' },
      { pointer: '/c~0d', detail: 'Expected string' },
    ]);
  });

  it('is reported with at most 20 issues, and how many more there were', () => {
    const many = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`p${index}`, { type: 'string' }]));
    const issues = answerIssues(compiled({ properties: many, required: Object.keys(many) }), {});

    expect(jsonSchemaLimits.issues).toBe(20);
    expect(issues).toHaveLength(21);
    expect(issues.at(-1)).toEqual({ pointer: '', detail: '130 more issues are not shown' });
  });

  it('says so when one more issue was found than it shows', () => {
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`p${index}`, { type: 'string' }]));

    expect(answerIssues(compiled({ properties: many, required: Object.keys(many) }), {}).at(-1)).toEqual({
      pointer: '',
      detail: '1 more issue is not shown',
    });
  });
});

describe('an answer checked further than its schema can say', () => {
  const ordered = Result.getOrThrow(
    compileJsonSchema(
      { type: 'array', items: { type: 'number' } },
      {
        ...asAnAnswer,
        further: (answer) =>
          Array.isArray(answer) && answer.length > 1 && answer[0] === answer[1]
            ? [{ pointer: '/1', detail: 'Expected a number other than the one before it' }]
            : [],
      },
    ),
  );

  it('is returned unchanged when it holds what the further check asks too', () => {
    expect(ordered.validate([1, 2])).toEqual(Result.succeed([1, 2]));
  });

  it('is reported with the issues of the further check after those of the schema', () => {
    expect(answerIssues(ordered, [3, 3])).toEqual([
      { pointer: '/1', detail: 'Expected a number other than the one before it' },
    ]);
    expect(answerIssues(ordered, ['x', 'x'])).toEqual([
      { pointer: '/0', detail: 'Expected number' },
      { pointer: '/1', detail: 'Expected number' },
      { pointer: '/1', detail: 'Expected a number other than the one before it' },
    ]);
  });

  it('is not checked further when it is not JSON, or nests deeper than the limit', () => {
    expect([answerIssues(ordered, new Date(0)), answerIssues(ordered, nestedObjects(answerNesting + 1))]).toEqual([
      [{ pointer: '', detail: 'The answer is not JSON' }],
      [{ pointer: '', detail: `The answer nests more than ${answerNesting} levels` }],
    ]);
  });
});

describe('an answer that cannot be checked', () => {
  it('is rejected when it is nested deeper than the limit', () => {
    const anything = compiled({});

    expect(answerIssues(anything, nestedObjects(answerNesting + 1))).toEqual([
      { pointer: '', detail: `The answer nests more than ${answerNesting} levels` },
    ]);
    expect(anything.validate(nestedObjects(answerNesting))).toEqual(Result.succeed(nestedObjects(answerNesting)));
  });

  it('is rejected, without overflowing the stack, when a recursive schema meets a deep answer', () => {
    expect(answerIssues(compiled(tree), nestedChildren(100_000))).toEqual([
      { pointer: '', detail: `The answer nests more than ${answerNesting} levels` },
    ]);
  });

  it('is rejected when it is not JSON', () => {
    expect(answerIssues(compiled({}), new Date(0))).toEqual([{ pointer: '', detail: 'The answer is not JSON' }]);
  });
});
