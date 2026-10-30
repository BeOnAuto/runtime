import { refusedInput } from '@on.auto/definitions';
import type { InvalidInput } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { answerIssuesOf } from './answer-check.ts';

export function answerFor(answer: Schema.Json, schema: Schema.JsonObject): Effect.Effect<Schema.Json, InvalidInput> {
  const issues = answerIssuesOf(answer, schema);
  return issues.length === 0 ? Effect.succeed(answer) : Effect.fail(refusedInput(issues));
}
