import type { Schema } from 'effect';

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'error' | 'other';

export interface InputTokens {
  readonly total: number | null;
  readonly uncached: number | null;
  readonly cache_read: number | null;
  readonly cache_write: number | null;
}

export interface OutputTokens {
  readonly total: number | null;
  readonly text: number | null;
  readonly reasoning: number | null;
}

export interface TokenUsage {
  readonly input: InputTokens;
  readonly output: OutputTokens;
  readonly total: number | null;
}

export interface ModelIdentity {
  readonly requested: string;
  readonly resolved: string;
  readonly answered: string;
}

export interface ModelWarning {
  readonly type: 'unsupported' | 'compatibility' | 'deprecated' | 'other';
  readonly feature: string | null;
  readonly detail: string | null;
}

export interface ModelResult {
  readonly text: string;
  readonly json?: Schema.Json;
  readonly finish_reason: FinishReason;
  readonly raw_finish_reason: string | null;
  readonly usage: TokenUsage;
  readonly model: ModelIdentity;
  readonly response_id: string | null;
  readonly cost_usd?: number;
  readonly warnings: readonly ModelWarning[];
  readonly response: string;
  readonly request_bytes: number;
  readonly duration_ms: number;
}

export const unknownUsage: TokenUsage = {
  input: { total: null, uncached: null, cache_read: null, cache_write: null },
  output: { total: null, text: null, reasoning: null },
  total: null,
};

function added(spent: number | null, more: number | null): number | null {
  return spent === null && more === null ? null : (spent ?? 0) + (more ?? 0);
}

export function addedUsage(spent: TokenUsage, more: TokenUsage): TokenUsage {
  return {
    input: {
      total: added(spent.input.total, more.input.total),
      uncached: added(spent.input.uncached, more.input.uncached),
      cache_read: added(spent.input.cache_read, more.input.cache_read),
      cache_write: added(spent.input.cache_write, more.input.cache_write),
    },
    output: {
      total: added(spent.output.total, more.output.total),
      text: added(spent.output.text, more.output.text),
      reasoning: added(spent.output.reasoning, more.output.reasoning),
    },
    total: added(spent.total, more.total),
  };
}
