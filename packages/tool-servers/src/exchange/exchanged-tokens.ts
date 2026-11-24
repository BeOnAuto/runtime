import type { FetchLike } from '@modelcontextprotocol/client';
import type { SubjectTokensOfACall } from '@on.auto/operations';
import { JsonPointer, type Schema } from 'effect';

import { mintCheckedOf, type AssertionChecked } from '../assertions/assertion-checks.ts';
import { tokensRequestedOf, type AssertedTokens } from '../assertions/requested-tokens.ts';
import { tokensAnswered } from '../assertions/token-answers.ts';
import { tokenExchangeGrant, type TokenExchange } from './token-exchanges.ts';

export interface Exchanging {
  readonly fetch: FetchLike;
  readonly now: () => number;
  readonly subjectTokens?: SubjectTokensOfACall | undefined;
  readonly org?: string | undefined;
}

export class SubjectTokensAbsent extends Error {
  constructor() {
    super('This Auto server signs no tokens of its own, so it cannot get a token for this connection');
  }
}

function signedSubjectOf({ subject_token: subjectToken }: TokenExchange, exchanging: Exchanging): Promise<string> {
  const { subjectTokens, org } = exchanging;
  return subjectTokens === undefined || org === undefined
    ? Promise.reject(new SubjectTokensAbsent())
    : subjectTokens.signedFor({ org, audience: subjectToken.audience });
}

function scopesIn(scope: string | undefined): readonly string[] {
  return (scope ?? '').split(' ').filter((asked) => asked !== '');
}

function exchangeFormOf(exchange: TokenExchange, subjectToken: string, scope: string | undefined): string {
  const scopes = scopesIn(scope);
  const asked = exchange.impersonation === undefined && scopes.length > 0 ? { scope: scopes.join(' ') } : {};
  return new URLSearchParams({
    ...exchange.parameters,
    ...asked,
    grant_type: tokenExchangeGrant,
    audience: exchange.audience,
    subject_token: subjectToken,
    subject_token_type: exchange.subject_token.type,
  }).toString();
}

function bodyAt(pointer: string, scopes: readonly string[]): Schema.Json {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token))
    .reduceRight<Schema.Json>((held, name) => ({ [name]: held }), [...scopes]);
}

export async function exchangedTokensOf(
  exchange: TokenExchange,
  scope: string | undefined,
  exchanging: Exchanging,
): Promise<AssertedTokens> {
  const subjectToken = await signedSubjectOf(exchange, exchanging);
  const answer = await exchanging.fetch(exchange.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: exchangeFormOf(exchange, subjectToken, scope),
    redirect: 'manual',
  });
  const exchanged = await tokensAnswered(answer, new URL(exchange.token_endpoint).hostname);
  const { impersonation } = exchange;
  return impersonation === undefined
    ? exchanged
    : tokensRequestedOf(
        impersonation,
        exchanged.access_token,
        exchanging,
        bodyAt(impersonation.request.scope, scopesIn(scope)),
      );
}

export function exchangeCheckedOf(
  exchange: TokenExchange,
  scope: string | undefined,
  exchanging: Exchanging,
): Promise<AssertionChecked> {
  return mintCheckedOf((fetch) => exchangedTokensOf(exchange, scope, { ...exchanging, fetch }), exchanging.fetch);
}
