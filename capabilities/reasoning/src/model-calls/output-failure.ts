import type { SchemaIssue } from '@on.auto/json-schema';
import { TypeValidationError, type FinishReason as SdkFinishReason } from 'ai';

import { ContentRefused } from '../failure/content-refused.ts';
import type { ModelFailure } from '../failure/model-failure.ts';
import { OutputInvalid } from '../failure/output-invalid.ts';
import { finishReasonOf, tokenUsage, type SdkUsage } from './answer-mapping.ts';
import { AnswerMismatch } from './answer-mismatch.ts';

export interface UnusableOutput {
  readonly provider: string;
  readonly finishReason: SdkFinishReason;
  readonly rawFinishReason: string | undefined;
  readonly usage: SdkUsage | undefined;
  readonly cause: unknown;
}

function mismatchIssues(cause: unknown): readonly SchemaIssue[] {
  return TypeValidationError.isInstance(cause) && cause.cause instanceof AnswerMismatch ? cause.cause.issues : [];
}

function outputDetail(finishReason: SdkFinishReason, issues: readonly SchemaIssue[]): string {
  if (finishReason === 'length') {
    return 'The answer was cut off at max_output_tokens before it was complete';
  }
  return issues.length > 0 ? 'The answer does not match the output schema' : 'The answer is not JSON';
}

export function outputFailure(output: UnusableOutput): ModelFailure {
  const { provider, finishReason } = output;
  const usage = output.usage === undefined ? null : tokenUsage(output.usage);
  const raw_finish_reason = output.rawFinishReason ?? null;
  if (finishReason === 'content-filter') {
    return new ContentRefused({
      detail: `${provider} stopped the answer under its content policy`,
      provider,
      status: null,
      raw_finish_reason,
      usage,
    });
  }
  const issues = mismatchIssues(output.cause);
  return new OutputInvalid({
    detail: outputDetail(finishReason, issues),
    provider,
    finish_reason: finishReasonOf(finishReason),
    raw_finish_reason,
    usage,
    issues,
  });
}
