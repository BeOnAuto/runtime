import type { FetchLike } from '@modelcontextprotocol/client';

import type { ConsentCall } from '../consent/consent-client.ts';
import { AssertionConflict, type AssertionConflicting } from './assertion-conflict.ts';
import { AssertionRefused } from './assertion-refused.ts';
import { assertedTokensOf, type Asserting, type Assertion } from './signed-assertions.ts';
import { TokenRequestFailed } from './token-request-failed.ts';

export type AssertionChecked =
  | { readonly kind: 'taken' }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'conflicting'; readonly refusal: AssertionConflicting }
  | { readonly kind: 'unanswered'; readonly call: ConsentCall }
  | { readonly kind: 'unreached'; readonly hosts: readonly string[] };

function answeredBy(status: number, host: string): AssertionChecked {
  const answer = status >= 200 && status < 300 ? { failed: 'unreadable' as const } : { status, retryAfterMs: null };
  return { kind: 'unanswered', call: { step: 'token', host, answer } };
}

function checkedAfter(error: unknown, hosts: readonly string[]): AssertionChecked {
  if (error instanceof AssertionRefused) {
    return { kind: 'refused', code: error.code };
  }
  if (error instanceof AssertionConflict) {
    return { kind: 'conflicting', refusal: error.refusal };
  }
  return error instanceof TokenRequestFailed && !error.passing
    ? answeredBy(error.status, error.host)
    : { kind: 'unreached', hosts };
}

export function mintCheckedOf(
  mint: (fetch: FetchLike) => Promise<unknown>,
  fetchOfTheCheck: FetchLike,
): Promise<AssertionChecked> {
  const asked = new Set<string>();
  const fetch: FetchLike = (...[address, init]: readonly [unknown, unknown?]) => {
    asked.add(new URL(String(address)).hostname);
    return fetchOfTheCheck(String(address), Object.assign({}, init));
  };
  return mint(fetch).then(
    (): AssertionChecked => ({ kind: 'taken' }),
    (error: unknown) => checkedAfter(error, [...asked]),
  );
}

export function assertionCheckedOf(assertion: Assertion, asserting: Asserting): Promise<AssertionChecked> {
  return mintCheckedOf((fetch) => assertedTokensOf(assertion, { ...asserting, fetch }), asserting.fetch);
}
