import { Data } from 'effect';

export class RateLimited extends Data.TaggedError('rate_limited')<{
  readonly detail: string;
  readonly provider: string;
  readonly retry_after_ms: number | null;
}> {}
