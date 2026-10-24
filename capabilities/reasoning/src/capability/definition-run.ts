import type { RunContext, Finished } from '@on.auto/definitions';
import { Effect, type Schema } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import { promptOfTheAttempt } from './attempt-prompt.ts';
import { beforeTheSteps } from './before-the-steps.ts';
import type { DefinitionRejection } from './model-rejection.ts';
import { answerOf } from './run-answer.ts';
import type { RunServices } from './run-services.ts';
import { finishedOf } from './spending-record.ts';

export function definitionRun({
  languageModel,
  clock,
  tools: access,
  content,
  performJob,
  reading,
}: RunServices & { readonly performJob: NonNullable<RunServices['performJob']> }): (
  definition: ReasoningFunctionDefinitionDocument,
  input: Schema.Json,
  run: RunContext,
) => Effect.Effect<Finished, DefinitionRejection> {
  const runClock = clock === undefined ? Effect.clockWith(Effect.succeed) : Effect.succeed(clock);
  const answering = { languageModel, access, reading, content, perform: performJob };
  return Effect.fnUntraced(function* (
    definition: ReasoningFunctionDefinitionDocument,
    input: Schema.Json,
    run: RunContext,
  ) {
    const before = beforeTheSteps(run.journal, definition.model);
    const prompt = yield* promptOfTheAttempt({ content, clock: runClock }, { definition, input, run, before });
    const answered = yield* answerOf(answering, { definition, prompt, run, before });
    return yield* finishedOf(definition, answered);
  });
}
