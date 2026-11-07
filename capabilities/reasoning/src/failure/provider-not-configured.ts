import { Data } from 'effect';

import type { SchemaRefusal } from '../model/model-result.ts';

export class ProviderNotConfigured extends Data.TaggedError('provider_not_configured')<{
  readonly detail: string;
  readonly provider: string;
  readonly configured: readonly string[];
  readonly missing: readonly string[];
  readonly schema_refusal?: SchemaRefusal;
}> {}
