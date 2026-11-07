import type { SchemaIssue } from '@on.auto/json-schema';
import { TypeValidationError, type FinishReason as SdkFinishReason } from 'ai';

import { ContentRefused } from '../failure/content-refused.ts';
import type { ModelFailure } from '../failure/model-failure.ts';
import { OutputInvalid } from '../failure/output-invalid.ts';
import type { OutputMode, Repair, SchemaRefusal, TokenUsage } from '../model/model-result.ts';
import { finishReasonOf, tokenUsage, type SdkUsage } from './answer-mapping.ts';
import { AnswerMismatch } from './answer-mismatch.ts';

export interface UnusableOutput {
  readonly provider: string;
  readonly finishReason: SdkFinishReason;
  readonly rawFinishReason: string | undefined;
  readonly usage: TokenUsage | null;
  readonly cost_usd?: number;
  readonly issues: readonly SchemaIssue[];
  readonly refused: boolean;
  readonly output_mode?: OutputMode;
  readonly repair?: Repair;
  readonly schema_refusal?: SchemaRefusal;
}

export function mismatchIssues(cause: unknown): readonly SchemaIssue[] {
  return TypeValidationError.isInstance(cause) && cause.cause instanceof AnswerMismatch ? cause.cause.issues : [];
}

function outputDetail(finishReason: SdkFinishReason, issues: readonly SchemaIssue[]): string {
  if (finishReason === 'length') {
    return 'The answer was cut off at max_output_tokens before it was complete';
  }
  return issues.length > 0 ? 'The answer does not match the output schema' : 'The answer is not JSON';
}

function refusalDetail({ provider, finishReason, refused }: UnusableOutput): string | undefined {
  if (refused) {
    return `${provider} refused to answer`;
  }
  return finishReason === 'content-filter' ? `${provider} stopped the answer under its content policy` : undefined;
}

type Recorded = Pick<UnusableOutput, 'cost_usd' | 'output_mode' | 'repair' | 'schema_refusal'>;

function recordedOf({ cost_usd: cost, output_mode: mode, repair, schema_refusal: refusal }: UnusableOutput): Recorded {
  return {
    ...(cost === undefined ? {} : { cost_usd: cost }),
    ...(mode === undefined ? {} : { output_mode: mode }),
    ...(repair === undefined ? {} : { repair }),
    ...(refusal === undefined ? {} : { schema_refusal: refusal }),
  };
}

export function outputFailure(output: UnusableOutput): ModelFailure {
  const { provider, finishReason, issues, usage } = output;
  const raw_finish_reason = output.rawFinishReason ?? null;
  const refusal = refusalDetail(output);
  if (refusal !== undefined) {
    return new ContentRefused({
      detail: refusal,
      provider,
      status: null,
      raw_finish_reason,
      usage,
      ...recordedOf(output),
    });
  }
  return new OutputInvalid({
    detail: outputDetail(finishReason, issues),
    provider,
    finish_reason: finishReasonOf(finishReason),
    raw_finish_reason,
    usage,
    issues,
    ...recordedOf(output),
  });
}

export function unreadAnswerFailure(
  provider: string,
  finishReason: SdkFinishReason | undefined,
  usage: SdkUsage | undefined,
  cause: unknown,
): ModelFailure {
  return outputFailure({
    provider,
    finishReason: finishReason ?? 'other',
    rawFinishReason: undefined,
    usage: usage === undefined ? null : tokenUsage(usage),
    issues: mismatchIssues(cause),
    refused: false,
  });
}
