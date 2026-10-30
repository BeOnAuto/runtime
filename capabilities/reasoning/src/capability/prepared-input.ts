import { checkedInput, functionResourceLabels, refusedByTheInputSchema } from '@on.auto/definitions';
import type { InvalidInput } from '@on.auto/operations';
import { Effect, Predicate, type Schema } from 'effect';

import type { InputContract } from '../definition/reasoning-function-definition.ts';

function isJsonObject(value: Schema.Json): value is Schema.JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

const notAnObject = refusedByTheInputSchema({
  detail: 'The input of a reasoning function definition is a JSON object',
  issues: [{ pointer: '', detail: 'Expected a JSON object' }],
});

export function preparedInput(
  input: Schema.Json,
  { schema, defaults }: InputContract,
): Effect.Effect<Schema.JsonObject, InvalidInput> {
  if (!isJsonObject(input)) {
    return Effect.fail(notAnObject);
  }
  const merged: Schema.JsonObject = Object.fromEntries([...Object.entries(defaults), ...Object.entries(input)]);
  return Effect.as(checkedInput(merged, schema, functionResourceLabels.reasoning.singular), merged);
}
