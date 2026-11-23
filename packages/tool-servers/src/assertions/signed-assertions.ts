import { IssuerMismatchError, discoverAuthorizationServerMetadata, type FetchLike } from '@modelcontextprotocol/client';
import { boundedAnswerOf } from '@on.auto/outbound';
import { Option, Redacted, Schema } from 'effect';
import { importPKCS8, SignJWT } from 'jose';

import { ignored } from '../clients/ignored.ts';
import { passingErrorCodes } from '../consent/consent-failures.ts';
import { isPinnableUrl } from '../settings/checked.ts';
import { AssertionConflict } from './assertion-conflict.ts';
import { AssertionRefused } from './assertion-refused.ts';
import { TokenRequestFailed } from './token-request-failed.ts';

export const jwtBearerGrant = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

const assertionLifetimeMs = 300_000;

const mostAnswerBytes = 65_536;

const millisOfASecond = 1000;

const statusesOfARefusal: ReadonlySet<number> = new Set([400, 401]);

const rateLimited = 429;

const firstServerError = 500;

export interface Assertion {
  readonly issuer: string;
  readonly clientId: string;
  readonly subject: string | undefined;
  readonly scope: string | undefined;
  readonly privateKey: Redacted.Redacted;
  readonly algorithm: string;
}

export interface Asserting {
  readonly fetch: FetchLike;
  readonly now: () => number;
  readonly lifetimeMs?: number;
}

export interface AssertedTokens {
  readonly access_token: string;
  readonly expires_in?: number | undefined;
}

const refusalOfText = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ error: Schema.String.check(Schema.isPattern(/^[\w.-]{1,64}$/u)) })),
);

const tokensOfText = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      access_token: Schema.String.check(Schema.isMinLength(1)),
      expires_in: Schema.optionalKey(Schema.Unknown),
    }),
  ),
);

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

async function signedFor(assertion: Assertion, audience: string, asserting: Asserting): Promise<string> {
  const { lifetimeMs = assertionLifetimeMs } = asserting;
  const key = await importPKCS8(Redacted.value(assertion.privateKey), assertion.algorithm);
  const issuedAt = Math.floor(asserting.now() / millisOfASecond);
  const signing = new SignJWT(claimsOf(assertion))
    .setProtectedHeader({ alg: assertion.algorithm, typ: 'JWT' })
    .setIssuer(assertion.clientId);
  return namingItsSubject(signing, assertion.subject)
    .setAudience(audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + Math.floor(lifetimeMs / millisOfASecond))
    .sign(key);
}

function tokensIn(text: string, status: number, host: string): AssertedTokens {
  const { access_token: accessToken, expires_in: expiresIn } = Option.getOrThrowWith(
    tokensOfText(text),
    () => new TokenRequestFailed(status, host, false),
  );
  return typeof expiresIn === 'number' && expiresIn > 0
    ? { access_token: accessToken, expires_in: expiresIn }
    : { access_token: accessToken };
}

function failureOf(status: number, host: string, text: string): Error {
  const refusal = statusesOfARefusal.has(status) ? refusalOfText(text) : Option.none();
  return Option.match(refusal, {
    onNone: () => new TokenRequestFailed(status, host, status === rateLimited || status >= firstServerError),
    onSome: ({ error }) =>
      passingErrorCodes.includes(error) ? new TokenRequestFailed(status, host, true) : new AssertionRefused(error),
  });
}

async function tokensAnswered(response: Readonly<Response>, host: string): Promise<AssertedTokens> {
  const text = await boundedAnswerOf(response, mostAnswerBytes, ignored).text();
  if (response.ok) {
    return tokensIn(text, response.status, host);
  }
  throw failureOf(response.status, host, text);
}

export async function assertedTokensOf(assertion: Assertion, asserting: Asserting): Promise<AssertedTokens> {
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
