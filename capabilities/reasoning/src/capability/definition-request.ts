import type { RunContext } from '@on.auto/definitions';
import { runBoundMs } from '@on.auto/tool-servers/policy';
import { Effect } from 'effect';

import { mostOutputTokens } from '../definition/definition-settings.ts';
import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { StepBounds } from '../steps/step-decision.ts';
import type { RequestBase } from '../steps/step-facts.ts';
import { promptMessages, type Prompt } from '../steps/step-messages.ts';
import type { RenderedPrompt } from '../template/compiled-template.ts';

const firstAnswerMilliseconds = 60_000;

const millisecondsPerOutputToken = 25;

function timeoutFor(maxOutputTokens: number): number {
  return firstAnswerMilliseconds + millisecondsPerOutputToken * maxOutputTokens;
}

export const longestRequestMs = timeoutFor(mostOutputTokens);

export function longestRunMsOf({ settings, tools }: ReasoningFunctionDefinitionDocument): number {
  const timeoutMs = timeoutFor(settings.max_output_tokens);
  return tools.length === 0 ? timeoutMs : runBoundMs(timeoutMs);
}

export function resumesAfterMsOf({ settings }: ReasoningFunctionDefinitionDocument, callMs: number): number {
  return timeoutFor(settings.max_output_tokens) + callMs;
}

export const defaultMostInputTokens = 2_000_000;

export interface ModelReading {
  readonly mostInputTokens: number;
  readonly contextWindowOf: (model: string) => Effect.Effect<number | undefined>;
}

export const unknownWindows: ModelReading = {
  mostInputTokens: defaultMostInputTokens,
  contextWindowOf: () => Effect.undefined,
};

const unbounded = Number.POSITIVE_INFINITY;

export function boundsFor(
  { settings, model }: ReasoningFunctionDefinitionDocument,
  { mostInputTokens, contextWindowOf }: ModelReading,
  offersTools: boolean,
): Effect.Effect<StepBounds> {
  return offersTools
    ? Effect.map(contextWindowOf(model), (contextWindow) => ({
        runBoundMs: runBoundMs(timeoutFor(settings.max_output_tokens)),
        limits: { contextWindow, mostInputTokens },
      }))
    : Effect.succeed({ runBoundMs: unbounded, limits: { contextWindow: undefined, mostInputTokens } });
}

export function requestBaseOf(
  definition: ReasoningFunctionDefinitionDocument,
  run: RunContext,
): Omit<RequestBase, 'output'> {
  return {
    model: definition.model,
    settings: definition.settings,
    ...(definition.provider_options === undefined ? {} : { provider_options: definition.provider_options }),
    timeout_ms: timeoutFor(definition.settings.max_output_tokens),
    run_id: run.id,
  };
}

export function promptOf({ instructions, message }: RenderedPrompt): Prompt {
  return { kind: 'prompt', ...(instructions === undefined ? {} : { instructions }), message };
}

export function requestFor(
  definition: ReasoningFunctionDefinitionDocument,
  { instructions, message }: RenderedPrompt,
  run: RunContext,
): ModelRequest {
  return {
    ...requestBaseOf(definition, run),
    output: definition.output,
    ...(instructions === undefined ? {} : { instructions }),
    messages: promptMessages({ kind: 'prompt', message }),
  };
}

export function renderedOf({ instructions, message }: Prompt): RenderedPrompt {
  return { ...(instructions === undefined ? {} : { instructions }), message };
}
