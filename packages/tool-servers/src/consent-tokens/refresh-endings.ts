import { Data } from 'effect';

import type { ConsentWay, TokensEnded } from '../consent/consent-client.ts';
import { endsTheGrant } from '../consent/consent-failures.ts';

export class RefreshEnded extends Data.TaggedError('refresh_ended')<{ readonly ended: TokensEnded }> {}

export function endingOf(failure: unknown, { ending_codes: endingCodes }: ConsentWay): TokensEnded | undefined {
  if (failure instanceof RefreshEnded) {
    return failure.ended;
  }
  return endsTheGrant(failure, endingCodes) ? 'consent_ended' : undefined;
}
