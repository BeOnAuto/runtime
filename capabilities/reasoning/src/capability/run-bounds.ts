import { callCountOf, runBoundMs } from '@on.auto/tool-servers/policy';
import { Effect } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import { defaultMostInputTokens } from '../settings/input-token-settings.ts';
import type { StepBounds } from '../steps/step-decision.ts';
import type { InputBudget } from '../tools/turn-meter.ts';
import { timeoutFor } from './definition-request.ts';

export interface InputTokensAllowed {
  readonly defaultInputTokens: number;
  readonly mostInputTokens: number;
}

export interface ModelReading extends InputTokensAllowed {
  readonly contextWindowOf: (model: string) => Effect.Effect<number | undefined>;
}

export const unknownWindows: ModelReading = {
  defaultInputTokens: defaultMostInputTokens,
  mostInputTokens: defaultMostInputTokens,
  contextWindowOf: () => Effect.undefined,
};

const unbounded = Number.POSITIVE_INFINITY;

function inputBudgetOf(
  asked: number | undefined,
  { defaultInputTokens, mostInputTokens }: InputTokensAllowed,
): InputBudget {
  return { allowed: Math.min(asked ?? defaultInputTokens, mostInputTokens), asked, most: mostInputTokens };
}

export function boundsFor(
  definition: ReasoningFunctionDefinitionDocument,
  reading: ModelReading,
  offersTools: boolean,
): Effect.Effect<StepBounds> {
  const { settings, model, max_input_tokens: maxInputTokens, max_tool_calls: maxToolCalls } = definition;
  const budget = inputBudgetOf(maxInputTokens, reading);
  const atItsLimits = { count: callCountOf(maxToolCalls), exitBehavior: definition.exit_behavior };
  return offersTools
    ? Effect.map(reading.contextWindowOf(model), (contextWindow) => ({
        runBoundMs: runBoundMs(timeoutFor(settings.max_output_tokens)),
        limits: { contextWindow, budget },
        ...atItsLimits,
      }))
    : Effect.succeed({ runBoundMs: unbounded, limits: { contextWindow: undefined, budget }, ...atItsLimits });
}
