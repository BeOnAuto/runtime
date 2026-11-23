import { Data } from 'effect';
import { importJWK, SignJWT } from 'jose';

import { jwkSetOf, publicJwkOf, type IssuerSigningKey, type JwkSet } from './issuer-documents.ts';

export const subjectTokenSeconds = 300;

const reservedSubjectPrefix = 'system:';

export interface SubjectTokenAsked {
  readonly org: string;
  readonly audience: string;
}

interface SubjectTokenClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
}

export interface SubjectTokens {
  readonly issuer: string;
  readonly signedFor: (asked: SubjectTokenAsked) => Promise<string>;
  readonly keySet: () => Promise<JwkSet>;
}

export class SubjectReserved extends Data.TaggedError('subject_reserved')<{ readonly subject: string }> {}

function subjectTokenClaimsOf(
  issuer: string,
  { org, audience }: SubjectTokenAsked,
  signedAt: number,
): SubjectTokenClaims {
  const iat = Math.floor(signedAt / 1000);
  return { iss: issuer, sub: org, aud: audience, iat, exp: iat + subjectTokenSeconds };
}

function preparedOnce<Prepared>(prepare: () => Promise<Prepared>): () => Promise<Prepared> {
  const held: { prepared?: Promise<Prepared> } = {};
  return () => (held.prepared ??= prepare());
}

interface IssuerSigning {
  readonly issuer: string;
  readonly key: IssuerSigningKey;
  readonly now?: () => number;
}

export function subjectTokensSignedWith({ issuer, key, now = Date.now }: IssuerSigning): SubjectTokens {
  const prepared = preparedOnce(async () => ({
    published: await publicJwkOf(key),
    signing: await importJWK({ ...key.jwk }, key.alg),
  }));
  return {
    issuer,
    signedFor: async (asked) => {
      if (asked.org.startsWith(reservedSubjectPrefix)) {
        throw new SubjectReserved({ subject: asked.org });
      }
      const { published, signing } = await prepared();
      return new SignJWT({ ...subjectTokenClaimsOf(issuer, asked, now()) })
        .setProtectedHeader({ alg: key.alg, kid: published.kid, typ: 'JWT' })
        .sign(signing);
    },
    keySet: async () => jwkSetOf([(await prepared()).published]),
  };
}
