import { Data } from 'effect';

import type { TokensEnded } from '../consent/consent-client.ts';
import { isInvalidGrant } from '../consent/consent-failures.ts';

export class RefreshEnded extends Data.TaggedError('refresh_ended')<{ readonly ended: TokensEnded }> {}

export function endingOf(failure: unknown): TokensEnded | undefined {
  if (failure instanceof RefreshEnded) {
    return failure.ended;
  }
  return isInvalidGrant(failure) ? 'consent_ended' : undefined;
}
