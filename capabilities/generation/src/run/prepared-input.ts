import { checkedInput, functionResourceLabels, refusedByTheInputSchema } from '@on.auto/definitions';
import type { ValueContract } from '@on.auto/definitions/document';
import type { InvalidInput } from '@on.auto/operations';
import { Effect, Predicate, type Schema } from 'effect';

function isJsonObject(value: Schema.Json): value is Schema.JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

const notAnObject = refusedByTheInputSchema({
  detail: 'The input of a generation function definition is a JSON object',
  issues: [{ pointer: '', detail: 'Expected a JSON object' }],
});

export function preparedInput(
  input: Schema.Json,
  { schema }: ValueContract,
): Effect.Effect<Schema.JsonObject, InvalidInput> {
  return isJsonObject(input)
    ? Effect.as(checkedInput(input, schema, functionResourceLabels.generation.singular), input)
    : Effect.fail(notAnObject);
}
