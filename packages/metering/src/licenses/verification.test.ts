import { errors, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  LICENSE_AUDIENCE,
  LICENSE_TOKEN_TYPE,
  licenseClaims,
  licenseVerifier,
  MOST_LICENSE_TOKEN_CHARACTERS,
  STANDARD_OFFLINE_MILLISECONDS,
  type ExpectedLicense,
  type LicenseEntitlement,
  type LicenseTrust,
} from '../index.ts';

const issuedAt = Date.UTC(2026, 9, 26);
const day = 86_400_000;
const entitlement: LicenseEntitlement = {
  issuer: 'https://licenses.auto.test',
  accountId: 'account',
  customerId: 'customer',
  licenseId: 'key',
  installationId: 'installation',
  clusterId: 'cluster',
  installationKeyDigest: 'a'.repeat(64),
  serial: 'serial',
  ring: 'local',
  plan: 'free',
  mode: 'standard',
  generation: 1,
  issuedAt,
  notBefore: issuedAt,
  expiresAt: issuedAt + STANDARD_OFFLINE_MILLISECONDS,
  refreshAfter: issuedAt + day,
  offlineDeadline: issuedAt + STANDARD_OFFLINE_MILLISECONDS,
  capabilities: ['prediction'],
  allocationIds: ['allocation'],
  grantIds: ['grant'],
};
const expected: ExpectedLicense = { binding: entitlement, now: issuedAt, minimumGeneration: 1 };
const defaultHeader = { alg: 'EdDSA', typ: LICENSE_TOKEN_TYPE, kid: 'current' };

function damagedSignature(token: string): string {
  const [header, payload, signature] = token.split('.');
  if (header === undefined || payload === undefined || signature === undefined)
    throw new Error('Expected a signed fixture');
  const changed = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
  return `${header}.${payload}.${changed}`;
}

async function signingFixture() {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA');
  const jwk = await exportJWK(publicKey);
  if (typeof jwk.x !== 'string') throw new Error('Expected a public Ed25519 coordinate');
  const trust: LicenseTrust = { issuer: entitlement.issuer, ring: 'local', keys: [{ keyId: 'current', x: jwk.x }] };
  const verify = licenseVerifier(trust);
  function sign(
    changes: Readonly<Record<string, unknown>> = {},
    header: Readonly<{ alg: string; typ?: string; kid?: string }> = defaultHeader,
  ) {
    return new SignJWT({ ...licenseClaims(entitlement), ...changes }).setProtectedHeader(header).sign(privateKey);
  }
  return { trust, verify, sign };
}

describe('signed runtime license verification', () => {
  it('verifies a license using only trusted public material', async () => {
    const fixture = await signingFixture();
    const token = await fixture.sign();
    expect(await fixture.verify(token, expected)).toEqual(entitlement);
    expect(JSON.stringify(fixture.trust)).not.toContain('private');
  });

  it('refuses an altered signature and a key from an untrusted issuer', async () => {
    const fixture = await signingFixture();
    await expect(fixture.verify(damagedSignature(await fixture.sign()), expected)).rejects.toThrow(
      errors.JWSSignatureVerificationFailed,
    );
    const attacker = await signingFixture();
    await expect(fixture.verify(await attacker.sign(), expected)).rejects.toThrow(
      errors.JWSSignatureVerificationFailed,
    );
    await expect(fixture.verify(await fixture.sign({ iss: 'https://other.test' }), expected)).rejects.toThrow(
      errors.JWTClaimValidationFailed,
    );
  });

  it('requires its own token type, audience and named trusted key', async () => {
    const fixture = await signingFixture();
    await expect(
      fixture.verify(await fixture.sign({}, { alg: 'EdDSA', typ: 'JWT', kid: 'current' }), expected),
    ).rejects.toThrow(errors.JWTClaimValidationFailed);
    await expect(
      fixture.verify(await fixture.sign({}, { alg: 'EdDSA', typ: LICENSE_TOKEN_TYPE, kid: 'unknown' }), expected),
    ).rejects.toThrow(errors.JWKSNoMatchingKey);
    await expect(
      fixture.verify(await fixture.sign({}, { alg: 'EdDSA', typ: LICENSE_TOKEN_TYPE }), expected),
    ).rejects.toThrow('name its trusted signing key');
    await expect(fixture.verify(await fixture.sign({ aud: 'runtime-api' }), expected)).rejects.toThrow(
      errors.JWTClaimValidationFailed,
    );
    await expect(fixture.verify(await fixture.sign({ aud: [LICENSE_AUDIENCE] }), expected)).rejects.toThrow(
      'unsupported',
    );
  });
});

describe('license trust boundaries', () => {
  it('refuses symmetric and unsigned token algorithms', async () => {
    const fixture = await signingFixture();
    const token = await new SignJWT({ ...licenseClaims(entitlement) })
      .setProtectedHeader({ alg: 'HS256', typ: LICENSE_TOKEN_TYPE, kid: 'current' })
      .sign(new Uint8Array(32));
    await expect(fixture.verify(token, expected)).rejects.toThrow(errors.JOSEAlgNotAllowed);
    await expect(fixture.verify('eyJhbGciOiJub25lIn0.e30.', expected)).rejects.toThrow(errors.JOSEAlgNotAllowed);
  });

  it.each(['accountId', 'installationId', 'clusterId', 'installationKeyDigest'])(
    'cannot be used for another %s',
    async (field) => {
      const fixture = await signingFixture();
      await expect(
        fixture.verify(await fixture.sign(), { ...expected, binding: { ...expected.binding, [field]: 'another' } }),
      ).rejects.toThrow('belongs to another');
    },
  );

  it('does not accept a local license in the production ring', async () => {
    const fixture = await signingFixture();
    const production = licenseVerifier({ ...fixture.trust, ring: 'production' });
    await expect(production(await fixture.sign(), expected)).rejects.toThrow('belongs to another');
  });

  it('supports overlapping trusted signing keys but never a caller-provided signing secret', async () => {
    const current = await signingFixture();
    const older = await signingFixture();
    const keys = [...current.trust.keys, ...older.trust.keys.map((key) => ({ ...key, keyId: 'older' }))];
    const verify = licenseVerifier({ ...current.trust, keys });
    expect(await verify(await current.sign(), expected)).toEqual(entitlement);
    expect(
      await verify(await older.sign({}, { alg: 'EdDSA', typ: LICENSE_TOKEN_TYPE, kid: 'older' }), expected),
    ).toEqual(entitlement);
  });
});

describe('license expiry and generation', () => {
  it('refuses expired and not-yet-valid licenses without clock leeway', async () => {
    const fixture = await signingFixture();
    await expect(fixture.verify(await fixture.sign(), { ...expected, now: entitlement.expiresAt })).rejects.toThrow(
      errors.JWTExpired,
    );
    await expect(fixture.verify(await fixture.sign({ nbf: issuedAt / 1000 + 1 }), expected)).rejects.toThrow(
      errors.JWTClaimValidationFailed,
    );
    await expect(fixture.verify(await fixture.sign({ iat: issuedAt / 1000 + 1 }), expected)).rejects.toThrow(
      'stale or outside',
    );
  });

  it('honors an earlier offline deadline and the last trusted generation', async () => {
    const fixture = await signingFixture();
    const deadline = issuedAt + 2 * day;
    const token = await fixture.sign({ offlineDeadline: deadline / 1000 });
    await expect(fixture.verify(token, { ...expected, now: deadline })).rejects.toThrow('stale or outside');
    await expect(fixture.verify(await fixture.sign(), { ...expected, minimumGeneration: 2 })).rejects.toThrow(
      'stale or outside',
    );
  });

  it('bounds tokens and requires a safe trusted clock and generation', async () => {
    const fixture = await signingFixture();
    await expect(fixture.verify('x'.repeat(MOST_LICENSE_TOKEN_CHARACTERS + 1), expected)).rejects.toThrow('size bound');
    await Promise.all(
      [-1, Number.NaN].map((now) =>
        expect(fixture.verify('', { ...expected, now })).rejects.toThrow('safe non-negative'),
      ),
    );
    await expect(fixture.verify('', { ...expected, minimumGeneration: -1 })).rejects.toThrow('safe non-negative');
    await expect(fixture.verify('', { ...expected, now: Number.MAX_SAFE_INTEGER })).rejects.toThrow(
      'supported date range',
    );
  });
});

describe('public license trust configuration', () => {
  it('refuses missing, repeated or excessive trusted key IDs', async () => {
    const { trust } = await signingFixture();
    for (const keys of [
      [],
      [...trust.keys, ...trust.keys],
      Array.from({ length: 9 }, (_, index) => ({ keyId: `key-${index}`, x: 'A'.repeat(43) })),
    ])
      expect(() => licenseVerifier({ ...trust, keys })).toThrow('distinct, bounded');
    expect(() => licenseVerifier({ ...trust, keys: [{ keyId: '', x: 'A'.repeat(43) }] })).toThrow('identifier');
  });

  it('requires canonical Ed25519 public coordinates', async () => {
    const { trust } = await signingFixture();
    for (const x of ['', 'not-a-key', '+'.repeat(43)])
      expect(() => licenseVerifier({ ...trust, keys: [{ keyId: 'key', x }] })).toThrow('Ed25519 key');
    expect(() => licenseVerifier({ ...trust, keys: [{ keyId: 'key', x: `${'A'.repeat(42)}B` }] })).toThrow(
      'canonical base64url',
    );
  });
});
