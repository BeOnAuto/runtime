import {
  AuthorizationServerMismatchError,
  IssuerMismatchError,
  OAuthError,
  type FetchLike,
} from '@modelcontextprotocol/client';

import type { ConsentCall } from '../consent/consent-client.ts';
import { passingErrorCodes } from '../consent/consent-failures.ts';
import { AssertionConflict, type AssertionConflicting } from './assertion-conflict.ts';
import { AssertionRefused } from './assertion-refused.ts';
import { assertedTokensOf, type Asserting, type Assertion } from './signed-assertions.ts';
import { statusesOfARefusal } from './token-answers.ts';
import { TokenRequestFailed } from './token-request-failed.ts';

export type AssertionChecked =
  | { readonly kind: 'taken' }
  | { readonly kind: 'refused'; readonly code: string; readonly description?: string }
  | { readonly kind: 'conflicting'; readonly refusal: AssertionConflicting }
  | { readonly kind: 'unanswered'; readonly call: ConsentCall }
  | { readonly kind: 'unreached'; readonly hosts: readonly string[] };

const errorCodePattern = /^[\w.-]{1,64}$/u;

export const mostDescriptionCharacters = 300;

export function descriptionShownOf(
  { code, message }: Pick<OAuthError, 'code' | 'message'>,
  most: number = mostDescriptionCharacters,
): { readonly description?: string } {
  const description = message.replaceAll(/\s+/gu, ' ').trim().slice(0, most);
  return description === '' || description === code ? {} : { description };
}

function isARefusalOf(error: unknown, status: number | undefined): error is OAuthError {
  const answeredARefusal = status !== undefined && statusesOfARefusal.has(status);
  return (
    answeredARefusal &&
    error instanceof OAuthError &&
    errorCodePattern.test(error.code) &&
    !passingErrorCodes.includes(error.code)
  );
}

function answeredBy(status: number, host: string): AssertionChecked {
  const answer = status >= 200 && status < 300 ? { failed: 'unreadable' as const } : { status, retryAfterMs: null };
  return { kind: 'unanswered', call: { step: 'token', host, answer } };
}

function conflictOf(error: unknown): AssertionConflicting | undefined {
  if (error instanceof AssertionConflict) {
    return error.refusal;
  }
  if (error instanceof IssuerMismatchError) {
    return { refused: 'another_issuer', named: String(error.received), by: 'authorization_server' };
  }
  return error instanceof AuthorizationServerMismatchError
    ? { refused: 'another_issuer', named: error.currentIssuer, by: 'server' }
    : undefined;
}

interface Asked {
  readonly hosts: readonly string[];
  readonly lastStatus: number | undefined;
}

function checkedAfter(error: unknown, { hosts, lastStatus }: Asked): AssertionChecked {
  if (error instanceof AssertionRefused) {
    return { kind: 'refused', code: error.code };
  }
  if (isARefusalOf(error, lastStatus)) {
    return { kind: 'refused', code: error.code, ...descriptionShownOf(error) };
  }
  const refusal = conflictOf(error);
  if (refusal !== undefined) {
    return { kind: 'conflicting', refusal };
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
  const answered: { status?: number } = {};
  const fetch: FetchLike = async (...[address, init]: readonly [unknown, unknown?]) => {
    asked.add(new URL(String(address)).hostname);
    const response = await fetchOfTheCheck(String(address), Object.assign({}, init));
    answered.status = response.status;
    return response;
  };
  return mint(fetch).then(
    (): AssertionChecked => ({ kind: 'taken' }),
    (error: unknown) => checkedAfter(error, { hosts: [...asked], lastStatus: answered.status }),
  );
}

export function assertionCheckedOf(assertion: Assertion, asserting: Asserting): Promise<AssertionChecked> {
  return mintCheckedOf((fetch) => assertedTokensOf(assertion, { ...asserting, fetch }), asserting.fetch);
}
