import { inputReadBy, renderClockOf, templateLimits } from '@on.auto/definitions/template';
import { InvalidInput, type AssetHolding, type AssetNotRead, type PlaybookAddress } from '@on.auto/operations';
import { Effect, JsonPointer, Result, type Clock, type Schema } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import type { Prompt } from '../steps/step-messages.ts';
import type { CompiledTemplate, RenderedPrompt, RenderFailure, TemplateScope } from '../template/compiled-template.ts';
import { promptOf } from './definition-request.ts';
import { preparedInput } from './prepared-input.ts';

const inputPath = /^input\./u;

const exceeded = { memory: 'more memory', time: 'more time' } as const;

function pointerOf(variable: string): string {
  return inputPath.test(variable)
    ? variable
        .replace(inputPath, '')
        .split('.')
        .map((segment) => `/${JsonPointer.escapeToken(segment)}`)
        .join('')
    : '';
}

function rejection(detail: string, issue: string, pointer = ''): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail: issue }] });
}

function rejectionOf(failure: RenderFailure): InvalidInput {
  if (failure.reason === 'missing_variable') {
    return rejection(
      `The template reads ${failure.variable} on line ${failure.line}, which the input does not have`,
      `Line ${failure.line}: the template reads ${failure.variable}, which this input does not have`,
      pointerOf(failure.variable),
    );
  }
  if (failure.reason === 'not_text') {
    return rejection(
      `The ${failure.part} of the prompt writes a kept file on line ${failure.line}, which a model does not read as text`,
      `Line ${failure.line}: write one of its fields here, such as media_type, or write | json after it`,
    );
  }
  if (failure.reason === 'too_long') {
    return rejection(
      `With this input the ${failure.part} of the prompt would be longer than the template may render`,
      `Line ${failure.line}: the ${failure.part} grows past 200000 characters here`,
    );
  }
  if (failure.reason === 'limit_exceeded') {
    return rejection(
      `Rendering the template with this input takes ${exceeded[failure.limit]} than a render may`,
      `Line ${failure.line}: the render stopped here`,
    );
  }
  return rejection('The template cannot be rendered with this input', `Line ${failure.line}: ${failure.detail}`);
}

const emptyMessage = rejection(
  'With this input the template renders an empty message',
  'The message the template renders from this input is empty',
);

function renderedPrompt(
  template: CompiledTemplate,
  scope: TemplateScope,
  clock: Clock.Clock,
): Effect.Effect<RenderedPrompt, InvalidInput> {
  return Result.match(template.render(scope, renderClockOf(clock)), {
    onFailure: (failure) => Effect.fail(rejectionOf(failure)),
    onSuccess: (prompt) => (prompt.message.trim() === '' ? Effect.fail(emptyMessage) : Effect.succeed(prompt)),
  });
}

export interface PromptAssets {
  readonly holding: AssetHolding;
  readonly playbook: PlaybookAddress;
}

function unread({ pointer, detail }: AssetNotRead): InvalidInput {
  return rejection(detail, detail, pointer);
}

function promptInputOf(
  { template }: ReasoningFunctionDefinitionDocument,
  fields: Schema.JsonObject,
  { holding, playbook }: PromptAssets,
): Effect.Effect<Schema.Json, InvalidInput> {
  const parts = template.hasInstructions ? 2 : 1;
  const bound = {
    most: parts * templateLimits.renderedCharacters,
    unit: 'characters',
    reader: 'a prompt holds',
    remedy: 'give it a shorter text, or split the work',
  } as const;
  return Effect.mapError(inputReadBy(template.variables, fields, { holding, playbook, bound }), unread);
}

export const renderedFor = Effect.fnUntraced(function* (
  definition: ReasoningFunctionDefinitionDocument,
  input: Schema.Json,
  clock: Clock.Clock,
  assets: PromptAssets,
) {
  const fields = yield* preparedInput(input, definition.input);
  const now = new Date(yield* clock.currentTimeMillis).toISOString();
  const scope = { input: yield* promptInputOf(definition, fields, assets), today: now.slice(0, 10), now };
  const prompt: Prompt = promptOf(yield* renderedPrompt(definition.template, scope, clock));
  return prompt;
});
