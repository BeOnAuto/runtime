import { compileJsonSchema } from '@on.auto/json-schema';
import type { InvalidInput } from '@on.auto/operations';
import { Result, type Schema } from 'effect';

import { refusedInput, wordedIssuesOf } from '../index.ts';

export function refusalOf(document: Schema.JsonObject, value: Schema.Json, what = 'input'): InvalidInput | undefined {
  const issues = wordedIssuesOf(Result.getOrThrow(compileJsonSchema(document, { what, nesting: 64 })), value);
  return issues.length === 0 ? undefined : refusedInput(issues);
}

export function refusalWordsOf(document: Schema.JsonObject, value: Schema.Json, what?: string): string | undefined {
  return refusalOf(document, value, what)?.detail;
}

export function fieldWords(field: Schema.JsonObject, value: Schema.Json): string | undefined {
  return refusalWordsOf({ type: 'object', properties: { field } }, { field: value });
}
