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
  readonly duration_ms: number;
}
