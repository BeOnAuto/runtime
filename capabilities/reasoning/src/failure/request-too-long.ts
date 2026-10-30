import { Data } from 'effect';

export class RequestTooLong extends Data.TaggedError('request_too_long')<{
  readonly detail: string;
  readonly provider: string;
  readonly status: number;
  readonly signal: string;
  readonly provider_message: string | null;
  readonly last_input_tokens: number | null;
}> {}
