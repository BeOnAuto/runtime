import { IssuerMismatchError, discoverAuthorizationServerMetadata, type FetchLike } from '@modelcontextprotocol/client';
import { Redacted } from 'effect';
import { importPKCS8, SignJWT } from 'jose';

import { isPinnableUrl } from '../settings/checked.ts';
import { AssertionConflict } from './assertion-conflict.ts';
import { tokensRequestedOf, type AssertedTokens } from './requested-tokens.ts';
import { tokensAnswered } from './token-answers.ts';
import type { TokenRequest } from './token-requests.ts';

export const jwtBearerGrant = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

const assertionLifetimeMs = 300_000;

const millisOfASecond = 1000;

const clockDriftSeconds = 60;

export interface Assertion {
  readonly issuer: string;
  readonly clientId: string;
  readonly subject: string | undefined;
  readonly scope: string | undefined;
  readonly privateKey: Redacted.Redacted;
  readonly algorithm: string;
  readonly tokenRequest?: TokenRequest | undefined;
}

export interface Asserting {
  readonly fetch: FetchLike;
  readonly now: () => number;
  readonly lifetimeMs?: number;
}

function conflictOrAsIs(issuer: string, error: unknown): unknown {
  return error instanceof IssuerMismatchError
    ? new AssertionConflict(issuer, {
        refused: 'another_issuer',
        named: String(error.received),
        by: 'authorization_server',
      })
    : error;
}

async function tokenEndpointOf(issuer: string, fetch: FetchLike): Promise<string> {
  const metadata = await discoverAuthorizationServerMetadata(issuer, { fetchFn: fetch }).catch((error: unknown) => {
    throw conflictOrAsIs(issuer, error);
  });
  const endpoint = metadata?.token_endpoint;
  if (endpoint === undefined) {
    throw new AssertionConflict(issuer, { refused: 'no_metadata' });
  }
  if (!isPinnableUrl(endpoint)) {
    throw new AssertionConflict(issuer, { refused: 'unpinned_endpoint', endpoint });
  }
  return endpoint;
}

function claimsOf({ scope }: Assertion): { readonly scope?: string } {
  return scope === undefined || scope === '' ? {} : { scope };
}

function namingItsSubject(signing: SignJWT, subject: string | undefined): SignJWT {
  return subject === undefined ? signing : signing.setSubject(subject);
}

function jwtOf(assertion: Assertion, claims: Readonly<Record<string, string>>): SignJWT {
  return new SignJWT(claims).setProtectedHeader({ alg: assertion.algorithm, typ: 'JWT' }).setIssuer(assertion.clientId);
}

function secondsOf(asserting: Asserting): { readonly now: number; readonly lifetime: number } {
  const { lifetimeMs = assertionLifetimeMs } = asserting;
  return { now: Math.floor(asserting.now() / millisOfASecond), lifetime: Math.floor(lifetimeMs / millisOfASecond) };
}

async function signedFor(assertion: Assertion, audience: string, asserting: Asserting): Promise<string> {
  const key = await importPKCS8(Redacted.value(assertion.privateKey), assertion.algorithm);
  const { now, lifetime } = secondsOf(asserting);
  return namingItsSubject(jwtOf(assertion, claimsOf(assertion)), assertion.subject)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetime)
    .sign(key);
}

async function signedForTheRequest(assertion: Assertion, asserting: Asserting): Promise<string> {
  const key = await importPKCS8(Redacted.value(assertion.privateKey), assertion.algorithm);
  const { now, lifetime } = secondsOf(asserting);
  return jwtOf(assertion, {})
    .setIssuedAt(now - clockDriftSeconds)
    .setExpirationTime(now + lifetime)
    .sign(key);
}

export async function assertedTokensOf(assertion: Assertion, asserting: Asserting): Promise<AssertedTokens> {
  const { tokenRequest } = assertion;
  if (tokenRequest !== undefined) {
    return tokensRequestedOf(tokenRequest, await signedForTheRequest(assertion, asserting), asserting);
  }
  const endpoint = await tokenEndpointOf(assertion.issuer, asserting.fetch);
  const signed = await signedFor(assertion, endpoint, asserting);
  const answer = await asserting.fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: jwtBearerGrant, assertion: signed }).toString(),
    redirect: 'manual',
  });
  return tokensAnswered(answer, new URL(endpoint).hostname);
}
