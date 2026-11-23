import { generateKeyPairSync } from 'node:crypto';

import { Schema } from 'effect';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  issuerMetadataOf,
  jwkSetOf,
  jwkSetPath,
  mostPublishedKeys,
  publicJwkOf,
  type EcSigningKey,
  type IssuerSigningKey,
  type JwkSet,
  type PublicJwk,
  type RsaSigningKey,
} from './issuer-documents.ts';
import { subjectTokensSignedWith, subjectTokenSeconds } from './subject-tokens.ts';

const issuer = 'https://runtime.example.com/oidc';

const signedAt = Date.parse('2026-11-23T09:00:00.000Z');

const RsaKey = Schema.Struct({
  kty: Schema.Literal('RSA'),
  n: Schema.String,
  e: Schema.String,
  d: Schema.String,
  p: Schema.String,
  q: Schema.String,
  dp: Schema.String,
  dq: Schema.String,
  qi: Schema.String,
});

const EcKey = Schema.Struct({
  kty: Schema.Literal('EC'),
  crv: Schema.Literal('P-256'),
  x: Schema.String,
  y: Schema.String,
  d: Schema.String,
});

function anRsaKey(): RsaSigningKey {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return Schema.decodeUnknownSync(RsaKey)(privateKey.export({ format: 'jwk' }));
}

function anEcKey(): EcSigningKey {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return Schema.decodeUnknownSync(EcKey)(privateKey.export({ format: 'jwk' }));
}

const rsa: IssuerSigningKey = { alg: 'RS256', jwk: anRsaKey() };

const keys: readonly (readonly [string, IssuerSigningKey, readonly string[]])[] = [
  ['RS256', rsa, ['kty', 'n', 'e']],
  ['ES256', { alg: 'ES256', jwk: anEcKey() }, ['kty', 'crv', 'x', 'y']],
];

function verifiedBy(keySet: JwkSet): ReturnType<typeof createLocalJWKSet> {
  return createLocalJWKSet({ keys: [...keySet.keys] });
}

const membersOfThePrivateKey = keys.flatMap(([alg, key, published]) =>
  Object.keys(key.jwk).map((member) => [alg, member, key, published.includes(member)] as const),
);

const asked = { org: 'org_2b7Kq', audience: 'https://sts.example.com/pools/auto' };

describe('a subject token', () => {
  it.each(keys)(
    'signed with %s, verifies against the key set the issuer publishes, for the organization and the audience asked, for 300 seconds',
    async (alg, key) => {
      const tokens = subjectTokensSignedWith({ issuer, key, now: () => signedAt });

      const token = await tokens.signedFor(asked);
      const again = await tokens.signedFor(asked);
      const { payload, protectedHeader } = await jwtVerify(token, verifiedBy(await tokens.keySet()), {
        issuer,
        audience: asked.audience,
        currentDate: new Date(signedAt),
      });
      const [published] = (await tokens.keySet()).keys;

      expect(payload).toEqual({
        iss: issuer,
        sub: asked.org,
        aud: asked.audience,
        iat: signedAt / 1000,
        exp: signedAt / 1000 + subjectTokenSeconds,
      });
      expect(protectedHeader).toEqual({ alg, kid: published?.kid, typ: 'JWT' });
      expect(decodeProtectedHeader(again)).toEqual(protectedHeader);
      expect(tokens.issuer).toBe(issuer);
    },
  );

  it.each(['system:managed-service-accounts', 'system:'])(
    'is refused for %s, a subject reserved for identities that are not organizations',
    async (org) => {
      const tokens = subjectTokensSignedWith({ issuer, key: rsa });

      await expect(tokens.signedFor({ ...asked, org })).rejects.toMatchObject({
        _tag: 'subject_reserved',
        subject: org,
      });
    },
  );

  it('names exactly the claims the issuer says it supports', async () => {
    const tokens = subjectTokensSignedWith({ issuer, key: rsa, now: () => signedAt });

    const { payload } = await jwtVerify(await tokens.signedFor(asked), verifiedBy(await tokens.keySet()), {
      currentDate: new Date(signedAt),
    });

    expect(Object.keys(payload).toSorted()).toEqual(issuerMetadataOf(issuer, 'RS256').claims_supported.toSorted());
  });
});

describe('the key set of the issuer', () => {
  it.each(membersOfThePrivateKey)(
    'of a %s key carries the member %s only where it is a public member',
    async (_alg, member, key, isPublic) => {
      const published = await publicJwkOf(key);

      expect(Object.keys(published).includes(member)).toBe(isPublic);
    },
  );

  it.each(keys)(
    'of a %s key names it by its thumbprint, its algorithm and its use alone',
    async (alg, key, members) => {
      const published = await publicJwkOf(key);

      expect(Object.keys(published).toSorted()).toEqual([...members, 'kid', 'alg', 'use'].toSorted());
      expect(published).toMatchObject({ alg, use: 'sig' });
    },
  );

  it.each([
    [1, 1],
    [2, 2],
    [3, 2],
  ])('of %i keys, at most 2 published, publishes %i, the first', async (given, kept) => {
    const published = await publicJwkOf(rsa);
    const many: readonly PublicJwk[] = Array.from({ length: given }, (_, at) => ({
      ...published,
      kid: `key-${String(at)}`,
    }));

    expect(jwkSetOf(many, 2).keys.map(({ kid }) => kid)).toEqual(many.slice(0, kept).map(({ kid }) => kid));
  });

  it('publishes at most 8 keys by default', () => {
    expect(mostPublishedKeys).toBe(8);
  });
});

describe('the metadata of the issuer', () => {
  it.each(['RS256', 'ES256'] as const)(
    'names the issuer, where its key set is, and %s as the one algorithm of its tokens',
    (alg) => {
      expect(issuerMetadataOf(issuer, alg)).toMatchObject({
        issuer,
        jwks_uri: `${issuer}${jwkSetPath}`,
        response_types_supported: ['id_token'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: [alg],
      });
    },
  );
});
