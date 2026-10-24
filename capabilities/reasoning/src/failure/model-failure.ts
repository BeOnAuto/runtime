import type { ContentRefused } from './content-refused.ts';
import type { OutputInvalid } from './output-invalid.ts';
import type { ProviderUnavailable } from './provider-unavailable.ts';
import type { RateLimited } from './rate-limited.ts';
import type { RequestFailure } from './request-failure.ts';
import type { TimedOut } from './timed-out.ts';

export type ModelFailure =
  | RequestFailure
  | RateLimited
  | ProviderUnavailable
  | ContentRefused
  | OutputInvalid
  | TimedOut;
