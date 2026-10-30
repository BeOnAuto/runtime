import { Data } from 'effect';

import type { FinishReason, TokenUsage } from '../model/model-result.ts';
import type { FailureIssue } from './failure-issue.ts';

export class OutputInvalid extends Data.TaggedError('output_invalid')<{
  readonly detail: string;
  readonly provider: string;
  readonly finish_reason: FinishReason;
  readonly raw_finish_reason: string | null;
  readonly usage: TokenUsage | null;
  readonly issues: readonly FailureIssue[];
}> {}
