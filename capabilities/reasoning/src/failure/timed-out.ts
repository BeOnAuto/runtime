import { Data } from 'effect';

import type { SchemaRefusal } from '../model/model-result.ts';

export class TimedOut extends Data.TaggedError('timed_out')<{
  readonly detail: string;
  readonly provider: string;
  readonly timeout_ms: number;
  readonly schema_refusal?: SchemaRefusal;
}> {}
