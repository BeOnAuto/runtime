import { Data } from 'effect';

export class ProviderNotConfigured extends Data.TaggedError('provider_not_configured')<{
  readonly detail: string;
  readonly provider: string;
  readonly configured: readonly string[];
  readonly missing: readonly string[];
}> {}
