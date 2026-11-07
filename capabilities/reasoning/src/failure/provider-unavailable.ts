import { Data } from 'effect';

import type { SchemaRefusal } from '../model/model-result.ts';

export class ProviderUnavailable extends Data.TaggedError('provider_unavailable')<{
  readonly detail: string;
  readonly provider: string;
  readonly status: number | null;
  readonly schema_refusal?: SchemaRefusal;
}> {}
