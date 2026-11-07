import { Data } from 'effect';

import type { SchemaRefusal } from '../model/model-result.ts';

export class RateLimited extends Data.TaggedError('rate_limited')<{
  readonly detail: string;
  readonly provider: string;
  readonly retry_after_ms: number | null;
  readonly schema_refusal?: SchemaRefusal;
}> {}
