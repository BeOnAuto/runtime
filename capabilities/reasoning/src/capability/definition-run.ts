import type { RunContext, Finished } from '@on.auto/definitions';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Effect, type Clock, type Schema } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import type { LanguageModel } from '../model/language-model.ts';
import type { DefinitionRejection } from './model-rejection.ts';
import { preparedInput } from './prepared-input.ts';
import { renderedPrompt } from './rendered-prompt.ts';
import { answerOf, type Answering } from './run-answer.ts';
import { finishedWith } from './spending-record.ts';

export interface RunServices {
  readonly languageModel: LanguageModel['Service'];
  readonly clock?: Clock.Clock;
  readonly tools: ToolAccess;
  readonly reading?: Answering['reading'];
}

function outputOf({ text, json }: { readonly text: string; readonly json?: Schema.Json }): Schema.Json {
  return json === undefined ? text : json;
}

export function definitionRun({
  languageModel,
  clock,
  tools: access,
  reading,
}: RunServices): (
  definition: ReasoningFunctionDefinitionDocument,
  input: Schema.Json,
  run: RunContext,
) => Effect.Effect<Finished, DefinitionRejection> {
  const runClock = clock === undefined ? Effect.clockWith(Effect.succeed) : Effect.succeed(clock);
  return Effect.fnUntraced(function* (
    definition: ReasoningFunctionDefinitionDocument,
    input: Schema.Json,
    run: RunContext,
  ) {
    const fields = yield* preparedInput(input, definition.input);
    const current = yield* runClock;
    const now = new Date(yield* current.currentTimeMillis).toISOString();
    const scope = { input: fields, today: now.slice(0, 10), now };
    const prompt = yield* renderedPrompt(definition.template, scope, current);
    const result = yield* answerOf({ languageModel, access, reading, definition, prompt, run });
    return yield* finishedWith(outputOf(result), {
      prompt,
      settings: definition.settings,
      format: definition.output.type,
      result,
    });
  });
}
