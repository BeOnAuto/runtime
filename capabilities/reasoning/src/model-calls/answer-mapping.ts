import type { FinishReason as SdkFinishReason } from 'ai';

import type { FinishReason, ModelWarning, TokenUsage } from '../model/model-result.ts';

export interface SdkUsage {
  readonly inputTokens: number | undefined;
  readonly inputTokenDetails: {
    readonly noCacheTokens: number | undefined;
    readonly cacheReadTokens: number | undefined;
    readonly cacheWriteTokens: number | undefined;
  };
  readonly outputTokens: number | undefined;
  readonly outputTokenDetails: {
    readonly textTokens: number | undefined;
    readonly reasoningTokens: number | undefined;
  };
  readonly totalTokens: number | undefined;
}

export type SdkWarning =
  | { readonly type: 'unsupported' | 'compatibility'; readonly feature: string; readonly details?: string }
  | { readonly type: 'deprecated'; readonly setting: string; readonly message: string }
  | { readonly type: 'other'; readonly message: string };

const finishReasons: Readonly<Record<SdkFinishReason, FinishReason>> = {
  stop: 'stop',
  length: 'length',
  'content-filter': 'content_filter',
  'tool-calls': 'tool_calls',
  error: 'error',
  other: 'other',
};

function counted(tokens: number | undefined): number | null {
  return tokens ?? null;
}

export function tokenUsage(usage: SdkUsage): TokenUsage {
  return {
    input: {
      total: counted(usage.inputTokens),
      uncached: counted(usage.inputTokenDetails.noCacheTokens),
      cache_read: counted(usage.inputTokenDetails.cacheReadTokens),
      cache_write: counted(usage.inputTokenDetails.cacheWriteTokens),
    },
    output: {
      total: counted(usage.outputTokens),
      text: counted(usage.outputTokenDetails.textTokens),
      reasoning: counted(usage.outputTokenDetails.reasoningTokens),
    },
    total: counted(usage.totalTokens),
  };
}

export function finishReasonOf(reason: SdkFinishReason): FinishReason {
  return finishReasons[reason];
}

export function warningOf(warning: SdkWarning): ModelWarning {
  if (warning.type === 'deprecated') {
    return { type: 'deprecated', feature: warning.setting, detail: warning.message };
  }
  if (warning.type === 'other') {
    return { type: 'other', feature: null, detail: warning.message };
  }
  return { type: warning.type, feature: warning.feature, detail: warning.details ?? null };
}

type ResponseHeaders = Readonly<Record<string, string | undefined>>;

export function costOf(headers: ResponseHeaders | undefined, header: string | null): number | undefined {
  const said = header === null ? undefined : headers?.[header]?.trim();
  if (said === undefined || said === '') {
    return undefined;
  }
  const cost = Number(said);
  return Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}
