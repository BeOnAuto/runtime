import { Data } from 'effect';

import type { FinishReason, OutputMode, Repair, SchemaRefusal, TokenUsage } from '../model/model-result.ts';
import type { FailureIssue } from './failure-issue.ts';

export class OutputInvalid extends Data.TaggedError('output_invalid')<{
  readonly detail: string;
  readonly provider: string;
  readonly finish_reason: FinishReason;
  readonly raw_finish_reason: string | null;
  readonly usage: TokenUsage | null;
  readonly cost_usd?: number;
  readonly issues: readonly FailureIssue[];
  readonly output_mode?: OutputMode;
  readonly repair?: Repair;
  readonly schema_refusal?: SchemaRefusal;
}> {}
