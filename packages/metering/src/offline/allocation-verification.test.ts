import { errors, CompactSign, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  allocationPayload,
  allocationVerifier,
  licenseClaims,
  MOST_ALLOCATION_TOKEN_CHARACTERS,
  OFFLINE_ALLOCATION_TYPE,
  type ExpectedAllocation,
  type LicenseEntitlement,
  type LicenseTrust,
  type OfflineAllocation,
} from '../index.ts';

const allocation: OfflineAllocation = {
  issuer: 'https://licenses.auto.test',
  ring: 'local',
  accountId: 'account',
  installationId: 'installation',
  clusterId: 'cluster',
  installationKeyDigest: 'a'.repeat(64),
  id: 'allocation',
  epoch: 1,
  mode: 'standard',
  issuedAt: 5_000,
  expiresAt: 604_805_000,
  sources: [{ lotId: 'grant', source: 'free', issuedAt: 1_000, expiresAt: 100_000, units: 40_000_000n }],
};
const expected: ExpectedAllocation = {
  license: {
    ...allocation,
    customerId: 'customer',
    licenseId: 'key',
    serial: 'license',
    generation: 1,
    plan: 'free',
    notBefore: 5_000,
    refreshAfter: 86_405_000,
    offlineDeadline: 604_805_000,
    capabilities: ['prediction'],
    allocationIds: ['allocation'],
    grantIds: ['grant'],
  },
  minimumEpoch: 1,
  now: 5_000,
};

const defaultHeader = { alg: 'EdDSA', typ: OFFLINE_ALLOCATION_TYPE, kid: 'key' };

async function fixture() {
  const pair = await generateKeyPair('EdDSA');
  const jwk = await exportJWK(pair.publicKey);
  if (jwk.x === undefined) throw new Error('Expected the fixture public coordinate');
  const trust: LicenseTrust = { issuer: allocation.issuer, ring: 'local', keys: [{ keyId: 'key', x: jwk.x }] };
  function sign(
    payload = allocationPayload(allocation),
    header: Readonly<{ alg: string; typ?: string; kid?: string }> = defaultHeader,
  ) {
    return new CompactSign(new TextEncoder().encode(payload)).setProtectedHeader(header).sign(pair.privateKey);
  }
  return { trust, verify: allocationVerifier(trust), sign, privateKey: pair.privateKey };
}

describe('signed offline source allocations', () => {
  it('accepts a committed capacity authorized by a verified installation license', async () => {
    const f = await fixture();
    expect(await f.verify(await f.sign(), expected)).toEqual(allocation);
  });

  it('refuses another signer, unsigned tokens and symmetric algorithms', async () => {
    const f = await fixture();
    const attacker = await fixture();
    await expect(f.verify(await attacker.sign(), expected)).rejects.toThrow(errors.JWSSignatureVerificationFailed);
    await expect(f.verify('eyJhbGciOiJub25lIn0.e30.', expected)).rejects.toThrow(errors.JOSEAlgNotAllowed);
    const hmac = await new CompactSign(new TextEncoder().encode(allocationPayload(allocation)))
      .setProtectedHeader({ alg: 'HS256', typ: OFFLINE_ALLOCATION_TYPE, kid: 'key' })
      .sign(new Uint8Array(32));
    await expect(f.verify(hmac, expected)).rejects.toThrow(errors.JOSEAlgNotAllowed);
  });

  it('requires a dedicated type and named public key', async () => {
    const f = await fixture();
    await Promise.all(
      [
        { alg: 'EdDSA', typ: 'JWT', kid: 'key' },
        { alg: 'EdDSA', typ: OFFLINE_ALLOCATION_TYPE },
      ].map(async (header: Readonly<{ alg: string; typ: string; kid?: string }>) =>
        expect(f.verify(await f.sign(undefined, header), expected)).rejects.toThrow('dedicated type'),
      ),
    );
    await expect(f.verify(await f.sign(undefined, { ...defaultHeader, kid: 'unknown' }), expected)).rejects.toThrow(
      errors.JWKSNoMatchingKey,
    );
    const license = await new SignJWT({ ...licenseClaims(expected.license) })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'auto-license+jwt', kid: 'key' })
      .sign(f.privateKey);
    await expect(f.verify(license, expected)).rejects.toThrow('dedicated type');
  });
});

describe('offline allocation scope', () => {
  it.each(['issuer', 'ring', 'accountId', 'installationId', 'clusterId', 'installationKeyDigest'])(
    'binds the license %s',
    async (field) => {
      const f = await fixture();
      await expect(
        f.verify(await f.sign(), {
          ...expected,
          license: { ...expected.license, [field]: 'another' },
        }),
      ).rejects.toThrow('another authority');
    },
  );

  it('binds the signing authority and deployment ring', async () => {
    const f = await fixture();
    await expect(
      allocationVerifier({ ...f.trust, issuer: 'https://other.test' })(await f.sign(), expected),
    ).rejects.toThrow('another authority');
    await expect(allocationVerifier({ ...f.trust, ring: 'production' })(await f.sign(), expected)).rejects.toThrow(
      'another authority',
    );
  });

  const unlicensed: readonly Partial<LicenseEntitlement>[] = [
    { mode: 'enterprise-offline' },
    { allocationIds: [] },
    { grantIds: [] },
  ];
  it.each(unlicensed)('requires licensed mode and exact source references: %j', async (changes) => {
    const f = await fixture();
    await expect(
      f.verify(await f.sign(), { ...expected, license: { ...expected.license, ...changes } }),
    ).rejects.toThrow('does not authorize');
  });
});

describe('offline allocation time and exact bytes', () => {
  it('requires trusted current time, epoch and validity from both authorities', async () => {
    const f = await fixture();
    const token = await f.sign();
    await Promise.all(
      [{ now: 4_999 }, { now: allocation.expiresAt }, { minimumEpoch: 2 }].map(
        (changes: Readonly<Partial<ExpectedAllocation>>) =>
          expect(f.verify(token, { ...expected, ...changes })).rejects.toThrow('stale'),
      ),
    );
    await Promise.all(
      [
        { notBefore: 5_001 },
        { issuedAt: 5_001 },
        { expiresAt: 5_000 },
        { offlineDeadline: 5_000 },
        { offlineDeadline: allocation.expiresAt - 1 },
      ].map((changes: Readonly<Partial<LicenseEntitlement>>) =>
        expect(f.verify(token, { ...expected, license: { ...expected.license, ...changes } })).rejects.toThrow('stale'),
      ),
    );
    await Promise.all(
      [-1, Number.NaN, Number.MAX_SAFE_INTEGER].map((now) =>
        expect(f.verify(token, { ...expected, now })).rejects.toThrow(RangeError),
      ),
    );
    await expect(f.verify(token, { ...expected, minimumEpoch: -1 })).rejects.toThrow('safe non-negative');
  });

  it('bounds token size before parsing or signature work', async () => {
    const f = await fixture();
    await expect(f.verify('x'.repeat(MOST_ALLOCATION_TOKEN_CHARACTERS + 1), expected)).rejects.toThrow('size bound');
  });

  it('refuses added content, changed whitespace, a BOM and malformed signed payloads', async () => {
    const f = await fixture();
    const payload = allocationPayload(allocation);
    await Promise.all(
      [payload.replace('"epoch":1', '"epoch":1,"businessContent":"secret"'), ` ${payload}`].map(async (text) =>
        expect(f.verify(await f.sign(text), expected)).rejects.toThrow('canonical'),
      ),
    );
    await Promise.all(
      [`\uFEFF${payload}`, 'not-json'].map(async (text) =>
        expect(f.verify(await f.sign(text), expected)).rejects.toThrow(SyntaxError),
      ),
    );
    await expect(f.verify(await f.sign('null'), expected)).rejects.toThrow('object');
  });
});
