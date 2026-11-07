import { outputShapeOf, type OutputShapeName } from '@on.auto/definitions';
import type { SchemaIssue } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { measuredSchemas, type AnswerSchemaCase } from '../schema-testing/answer-schemas.ts';
import { auditSchemas } from '../schema-testing/audit-schemas.ts';
import { definitionUsedTwice, revisionSchemas, sixteenAfterInlining } from '../schema-testing/revision-schemas.ts';
import { compileAnswerSchema, type AnswerSchema } from './answer-schema.ts';
import { portableIssues, type Budget } from './portable-checks.ts';
import { portableFormOf, type PortableForm } from './portable-schema.ts';

function compiled(document: Schema.JsonObject): AnswerSchema {
  return Result.getOrThrow(compileAnswerSchema(document));
}

function issuesOf(document: Schema.JsonObject): readonly SchemaIssue[] {
  const form = portableFormOf(compiled(document));
  return form.portable ? [] : form.issues;
}

function formOf(document: Schema.JsonObject): PortableForm {
  const form = portableFormOf(compiled(document));
  if (!form.portable) {
    throw new Error(`not portable: ${JSON.stringify(form.issues)}`);
  }
  return form;
}

function named(cases: readonly AnswerSchemaCase[]): readonly (readonly [string, AnswerSchemaCase])[] {
  return cases.map((one) => [one.name, one]);
}

const everyCase: readonly AnswerSchemaCase[] = [...measuredSchemas, ...auditSchemas, ...revisionSchemas];

const shapeBudgets: readonly (readonly [OutputShapeName, Partial<Budget>])[] = [
  ['series', { unions: 6, depth: 3 }],
  ['categories', { unions: 3, depth: 2 }],
  ['table', { unions: 2, depth: 2 }],
  ['text', { unions: 0, depth: 1 }],
];

describe('the report of what in an answer schema is not portable', () => {
  it.each(named(everyCase))('names it at its pointer, or nothing for a portable schema: %s', (_name, one) => {
    expect(issuesOf(one.document)).toEqual(one.issues);
  });
});

describe('the portable form of every schema the report passes', () => {
  it.each(named(everyCase.filter(({ issues }) => issues.length === 0)))(
    'keeps to the portable subset and compiles in the dialect: %s',
    (_name, { document }) => {
      const { sent } = formOf(document);

      expect(portableIssues(sent)).toEqual([]);
      expect(Result.isSuccess(compileAnswerSchema(sent))).toBe(true);
    },
  );
});

describe('the portable form of a schema asked for again', () => {
  it('is the one made the first time', () => {
    const schema = compiled(outputShapeOf('categories').schema);

    expect(portableFormOf(schema)).toBe(portableFormOf(schema));
  });
});

describe('the budget of the portable form of a shape', () => {
  it.each(shapeBudgets)('leaves room in the %s shape', (name, counted) => {
    expect(formOf(outputShapeOf(name).schema).budget).toMatchObject(counted);
  });
});

describe('the budget of a definition used more than once', () => {
  it('counts its fields that may be null where each use is, so 6 used twice are 12 and 8 used twice are 16', () => {
    expect([formOf(definitionUsedTwice).budget.unions, formOf(sixteenAfterInlining).budget.unions]).toEqual([12, 16]);
  });
});

describe('a schema built by hand that does not compile', () => {
  it('is not portable, with the issues of its compilation', () => {
    const handBuilt: AnswerSchema = {
      document: { type: 'banana' },
      what: 'answer',
      validate: () => Result.succeed(null),
      issuesOf: () => [],
    };

    expect(portableFormOf(handBuilt)).toMatchObject({ portable: false, issues: [{ pointer: '/type' }] });
  });
});
