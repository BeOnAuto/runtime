import { Buffer } from 'node:buffer';
import { verify } from 'node:crypto';

import { Option, Schema } from 'effect';

import { json } from './authorization-answers.ts';
import type { ClientRegistration } from './fake-clients.ts';
import type { FakeTokens } from './fake-grants.ts';

export type AssertionGranted = (form: Readonly<URLSearchParams>, requested: number) => Response;

const mostLifetimeSeconds = 3600;

const headerOfText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ alg: Schema.Literal('RS256') })));

const ClaimsSchema = Schema.Struct({
  iss: Schema.String,
  sub: Schema.optionalKey(Schema.String),
  aud: Schema.String,
  iat: Schema.Number,
  exp: Schema.Number,
});

type Claims = typeof ClaimsSchema.Type;

const claimsOfText = Schema.decodeUnknownOption(Schema.fromJsonString(ClaimsSchema));

interface Signed {
  readonly header: string;
  readonly claims: string;
  readonly signature: string;
}

function decoded(part: string): string {
  return Buffer.from(part, 'base64url').toString('utf8');
}

function signedOf(assertion: string): Signed | undefined {
  const [header, claims, signature, ...rest] = assertion.split('.');
  return header === undefined || claims === undefined || signature === undefined || rest.length > 0
    ? undefined
    : { header, claims, signature };
}

function isSignedBy({ header, claims, signature }: Signed, publicKey: string): boolean {
  return verify('sha256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url'));
}

function verifiedClaimsOf(assertion: string, publicKey: string | undefined): Claims | undefined {
  const signed = signedOf(assertion);
  if (signed === undefined || publicKey === undefined || Option.isNone(headerOfText(decoded(signed.header)))) {
    return undefined;
  }
  return isSignedBy(signed, publicKey) ? Option.getOrUndefined(claimsOfText(decoded(signed.claims))) : undefined;
}

function isTakenAt(claims: Claims, registration: ClientRegistration, tokenEndpoint: string): boolean {
  return (
    claims.iss === registration.clientId &&
    claims.aud === tokenEndpoint &&
    claims.exp > claims.iat &&
    claims.exp - claims.iat <= mostLifetimeSeconds
  );
}

export function assertionsGranted(
  registration: ClientRegistration,
  tokenEndpoint: string,
  tokens: FakeTokens,
): AssertionGranted {
  return (form, requested) => {
    const claims = verifiedClaimsOf(form.get('assertion') ?? '', registration.publicKey);
    if (claims === undefined || !isTakenAt(claims, registration, tokenEndpoint)) {
      return json({ error: 'invalid_grant' }, 400);
    }
    const { subjects } = registration;
    return claims.sub === undefined || subjects === undefined || subjects.includes(claims.sub)
      ? json(tokens.minted({ requested, clientId: registration.clientId, grant: undefined }))
      : json({ error: 'unauthorized_client' }, 401);
  };
}
