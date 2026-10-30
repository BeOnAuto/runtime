import { Data } from 'effect';

export class ProviderUnavailable extends Data.TaggedError('provider_unavailable')<{
  readonly detail: string;
  readonly provider: string;
  readonly status: number | null;
}> {}
