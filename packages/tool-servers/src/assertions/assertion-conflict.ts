import type { Refused } from '../consent/consent-client.ts';

export type AssertionConflicting = Refused<'another_issuer' | 'no_metadata' | 'unpinned_endpoint'>;

function wordsOf(issuer: string, refusal: AssertionConflicting): string {
  if (refusal.refused === 'another_issuer') {
    return `The authorization server ${issuer} names ${refusal.named} as its issuer in its own metadata`;
  }
  return refusal.refused === 'no_metadata'
    ? `The authorization server ${issuer} publishes no metadata that names its token endpoint`
    : `The authorization server ${issuer} names ${refusal.endpoint} as its token endpoint, which is not an https URL`;
}

export class AssertionConflict extends Error {
  readonly refusal: AssertionConflicting;

  constructor(issuer: string, refusal: AssertionConflicting) {
    super(wordsOf(issuer, refusal));
    this.refusal = refusal;
  }
}
