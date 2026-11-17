import { checkedInput, functionResourceLabels, refusedByTheInputSchema } from '@on.auto/definitions';
import type { ValueContract } from '@on.auto/definitions/document';
import { inputReadBy, templateLimits } from '@on.auto/definitions/template';
import { InvalidInput, type AssetNotRead, type PlaybookAddress } from '@on.auto/operations';
import { Effect, Predicate, type Schema } from 'effect';

import { assetsHeld, type AssetReading } from '../assets/held-assets.ts';
import type { GenerationFunctionDefinitionDocument } from '../document/generation-document.ts';
import type { RunnableModel } from './runnable-model.ts';

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
    ? Effect.as(checkedInput(input, schema, functionResourceLabels.generation.singular, 'passed_whole'), input)
    : Effect.fail(notAnObject);
}

interface PromptReading {
  readonly document: GenerationFunctionDefinitionDocument;
  readonly model: RunnableModel;
  readonly playbook: PlaybookAddress;
}

function unread({ pointer, detail }: AssetNotRead): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail }] });
}

export function promptInputOf(
  reading: AssetReading,
  fields: Schema.JsonObject,
  { document, model, playbook }: PromptReading,
): Effect.Effect<Schema.Json, InvalidInput> {
  const bound = {
    most: Math.min(templateLimits.renderedCharacters, model.entry.limits.prompt_characters),
    unit: 'characters',
    reader: 'the model takes in a prompt',
    remedy: 'give it a shorter text, or split the work',
  } as const;
  const holding = assetsHeld(reading);
  return Effect.mapError(inputReadBy(document.prompt.variables, fields, { holding, playbook, bound }), unread);
}
