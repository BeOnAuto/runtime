import { Data } from 'effect';

import type { TokenUsage } from '../model/model-result.ts';

export class ContentRefused extends Data.TaggedError('content_refused')<{
  readonly detail: string;
  readonly provider: string;
  readonly status: number | null;
  readonly raw_finish_reason: string | null;
  readonly usage: TokenUsage | null;
}> {}
