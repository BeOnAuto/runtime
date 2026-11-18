import { refusedInput } from '@on.auto/definitions';
import type { InvalidInput } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { answerIssuesOf } from './answer-check.ts';

const jsonHeldIn = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

function answerHeldAsText(answer: Schema.Json, schema: Schema.JsonObject): Option.Option<Schema.Json> {
  return typeof answer === 'string'
    ? Option.filter(jsonHeldIn(answer), (held) => answerIssuesOf(held, schema).length === 0)
    : Option.none();
}

export function answerFor(answer: Schema.Json, schema: Schema.JsonObject): Effect.Effect<Schema.Json, InvalidInput> {
  const issues = answerIssuesOf(answer, schema);
  if (issues.length === 0) {
    return Effect.succeed(answer);
  }
  return Option.match(answerHeldAsText(answer, schema), {
    onSome: (held) => Effect.succeed(held),
    onNone: () => Effect.fail(refusedInput(issues)),
  });
}
