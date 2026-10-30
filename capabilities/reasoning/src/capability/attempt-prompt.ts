import type { RunContext } from '@on.auto/definitions';
import { Effect, type Clock, type Schema } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import { keptIn, type ContentStore } from '../steps/kept-content.ts';
import { firstModelCallOf, keptPromptOf } from '../steps/recorded-steps.ts';
import type { Prompt } from '../steps/step-messages.ts';
import { unfinishedAfter } from '../tools/tool-endings.ts';
import { restartedWithoutContent, type BeforeTheSteps } from './before-the-steps.ts';
import type { DefinitionRejection } from './model-rejection.ts';
import { renderedFor } from './rendered-prompt.ts';

export interface PromptSources {
  readonly content: ContentStore;
  readonly clock: Effect.Effect<Clock.Clock>;
}

export interface PromptOf {
  readonly definition: ReasoningFunctionDefinitionDocument;
  readonly input: Schema.Json;
  readonly run: RunContext;
  readonly before: BeforeTheSteps;
}

export function promptOfTheAttempt(
  { content, clock }: PromptSources,
  { definition, input, run, before }: PromptOf,
): Effect.Effect<Prompt, DefinitionRejection> {
  const start = firstModelCallOf(run.journal.attempt.calls);
  if (start === undefined) {
    return Effect.flatMap(clock, (current) => renderedFor(definition, input, current));
  }
  return Effect.flatMap(keptPromptOf(keptIn(content, run), start), (kept) =>
    kept === undefined
      ? Effect.andThen(
          before.ended,
          unfinishedAfter(before.use, 'restarted_without_content', restartedWithoutContent, before.spent),
        )
      : Effect.succeed(kept),
  );
}
