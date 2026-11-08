import type { OutputShape } from '@on.auto/definitions';
import {
  boundedJsonSchema,
  compileJsonSchema,
  jsonSchemaLimits,
  type CompiledSchema,
  type SchemaIssue as Issue,
} from '@on.auto/json-schema';
import { Result } from 'effect';

import { toolInputPortabilityOf, type PortabilityIssue } from './schema-portability.ts';

export const schemaLimits = {
  ...jsonSchemaLimits,
  answerNesting: 128,
} as const;

export type AnswerSchema = CompiledSchema;

export function compileAnswerSchema(document: unknown): Result.Result<AnswerSchema, readonly Issue[]> {
  return compileJsonSchema(document, { what: 'answer', nesting: schemaLimits.answerNesting });
}

export function compileInputSchema(document: unknown): Result.Result<CompiledSchema, readonly Issue[]> {
  return compileJsonSchema(document, { what: 'input', nesting: schemaLimits.answerNesting });
}

export function shapedAnswerSchema({ schema, further }: OutputShape): AnswerSchema {
  return Result.getOrThrow(compileJsonSchema(schema, { what: 'answer', nesting: schemaLimits.answerNesting, further }));
}

export function notPortableAsToolInput(document: unknown): readonly PortabilityIssue[] {
  const bounded = boundedJsonSchema(document);
  return Result.isSuccess(bounded) ? toolInputPortabilityOf(bounded.success) : [];
}
