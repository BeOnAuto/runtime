import { MOST_MODEL_CALL_MS, MOST_OUTPUT_TOKENS, MOST_TOOL_CALL_MS, modelCallMsFor } from './call-bounds.ts';
import { MOST_REQUEST_INPUT_TOKENS, MOST_TURN_INPUT_TOKENS } from './turn-input.ts';

export const MOST_TOOL_CALLS = 25;

export const MOST_TURN_MS = 10 * 60 * 1000;

export interface TurnBounds {
  readonly toolCalls: number;
  readonly turnMs: number;
  readonly modelCallMs: number;
  readonly toolCallMs: number;
  readonly turnInputTokens: number;
  readonly requestInputTokens: number;
  readonly outputTokens: number;
}

export const TURN_BOUNDS: TurnBounds = {
  toolCalls: MOST_TOOL_CALLS,
  turnMs: MOST_TURN_MS,
  modelCallMs: MOST_MODEL_CALL_MS,
  toolCallMs: MOST_TOOL_CALL_MS,
  turnInputTokens: MOST_TURN_INPUT_TOKENS,
  requestInputTokens: MOST_REQUEST_INPUT_TOKENS,
  outputTokens: MOST_OUTPUT_TOKENS,
};

export function turnBoundsOf(given: Partial<TurnBounds> = {}): TurnBounds {
  const outputTokens = given.outputTokens ?? TURN_BOUNDS.outputTokens;
  return { ...TURN_BOUNDS, modelCallMs: modelCallMsFor(outputTokens), ...given };
}
