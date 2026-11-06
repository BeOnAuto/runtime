import { Data } from 'effect';

import type { OutputMode, Repair, TokenUsage } from '../model/model-result.ts';

export class ContentRefused extends Data.TaggedError('content_refused')<{
  readonly detail: string;
  readonly provider: string;
  readonly status: number | null;
  readonly raw_finish_reason: string | null;
  readonly usage: TokenUsage | null;
  readonly cost_usd?: number;
  readonly output_mode?: OutputMode;
  readonly repair?: Repair;
}> {}
