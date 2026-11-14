import { Effect } from 'effect';

import type { ModelReading } from '../capability/run-bounds.ts';
import type { InputBudget } from '../tools/turn-meter.ts';

export function budgetOf(tokens: number): InputBudget {
  return { allowed: tokens, asked: undefined, most: tokens };
}

export function readingUpTo(tokens: number, contextWindow?: number): ModelReading {
  return {
    defaultInputTokens: tokens,
    mostInputTokens: tokens,
    contextWindowOf: () => Effect.succeed(contextWindow),
  };
}

export function readingOf(defaultInputTokens: number, mostInputTokens: number): ModelReading {
  return { defaultInputTokens, mostInputTokens, contextWindowOf: () => Effect.undefined };
}
