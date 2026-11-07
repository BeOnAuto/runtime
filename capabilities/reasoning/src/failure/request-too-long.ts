import { Data } from 'effect';

import type { SchemaRefusal } from '../model/model-result.ts';

export class RequestTooLong extends Data.TaggedError('request_too_long')<{
  readonly detail: string;
  readonly provider: string;
  readonly status: number;
  readonly signal: string;
  readonly provider_message: string | null;
  readonly last_input_tokens: number | null;
  readonly schema_refusal?: SchemaRefusal;
}> {}
