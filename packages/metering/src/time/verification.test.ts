import { CompactSign, errors, exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  LICENSE_TIME_TYPE,
  MOST_TIME_TOKEN_CHARACTERS,
  licenseTimePayload,
  licenseTimeVerifier,
  readInstallationPublicKey,
  type LicenseTimeAttestation,
  type LicenseTrust,
} from '../index.ts';

const attestation: LicenseTimeAttestation = {
  issuer: 'https://accounts.auto.test',
  ring: 'local',
  requestId: 'fresh-request',
  serverTime: 1234567890123,
};
const header = { alg: 'EdDSA', typ: LICENSE_TIME_TYPE, kid: 'authority' };

async function fixture() {
  const pair = await generateKeyPair('EdDSA');
  const publicKey = readInstallationPublicKey(await exportJWK(pair.publicKey));
  const trust: LicenseTrust = {
    issuer: attestation.issuer,
    ring: 'local',
    keys: [{ keyId: 'authority', x: publicKey.x }],
  };
  const sign = (
    payload = licenseTimePayload(attestation),
    protectedHeader: Readonly<{ alg: string; typ?: string; kid?: string }> = header,
  ) => new CompactSign(new TextEncoder().encode(payload)).setProtectedHeader(protectedHeader).sign(pair.privateKey);
  return { trust, verify: licenseTimeVerifier(trust), sign };
}

describe('signed time bound to a fresh request', () => {
  it('authenticates millisecond time without trusting a host wall clock', async () => {
    const f = await fixture();
    expect(await f.verify(await f.sign(), attestation.requestId)).toEqual(attestation);
  });

  it('captures its configured authority and public keys', async () => {
    const f = await fixture();
    Object.assign(f.trust, { issuer: 'https://other.test', ring: 'production', keys: [] });
    expect(await f.verify(await f.sign(), attestation.requestId)).toEqual(attestation);
  });

  it('refuses an earlier request response, another authority and another ring', async () => {
    const f = await fixture();
    const alternatives: readonly Partial<LicenseTimeAttestation>[] = [
      { requestId: 'earlier-request' },
      { issuer: 'https://other.test' },
      { ring: 'production' },
    ];
    await Promise.all(
      alternatives.map(async (changes) => {
        const token = await f.sign(licenseTimePayload({ ...attestation, ...changes }));
        await expect(f.verify(token, attestation.requestId)).rejects.toThrow('another authority');
      }),
    );
  });
});

describe('license time signature boundaries', () => {
  it('requires the named trusted key and a dedicated protocol type', async () => {
    const f = await fixture();
    const missing: readonly Readonly<{ alg: string; typ?: string; kid?: string }>[] = [
      { alg: 'EdDSA', kid: 'authority', typ: 'auto-license+jwt' },
      { alg: 'EdDSA', typ: LICENSE_TIME_TYPE },
    ];
    await Promise.all(
      missing.map(async (value) => {
        await expect(f.verify(await f.sign(undefined, value), attestation.requestId)).rejects.toThrow('dedicated type');
      }),
    );
    await expect(
      f.verify(await f.sign(undefined, { ...header, kid: 'unknown' }), attestation.requestId),
    ).rejects.toThrow(errors.JWKSNoMatchingKey);
  });

  it('refuses forged, unsigned and symmetric tokens', async () => {
    const f = await fixture();
    const attacker = await fixture();
    await expect(f.verify(await attacker.sign(), attestation.requestId)).rejects.toThrow(
      errors.JWSSignatureVerificationFailed,
    );
    await expect(f.verify('eyJhbGciOiJub25lIn0.e30.', attestation.requestId)).rejects.toThrow(errors.JOSEAlgNotAllowed);
    const symmetric = await new CompactSign(new TextEncoder().encode(licenseTimePayload(attestation)))
      .setProtectedHeader({ ...header, alg: 'HS256' })
      .sign(new Uint8Array(32));
    await expect(f.verify(symmetric, attestation.requestId)).rejects.toThrow(errors.JOSEAlgNotAllowed);
  });

  it('bounds tokens and refuses a noncanonical expected request', async () => {
    const f = await fixture();
    await expect(f.verify('x'.repeat(MOST_TIME_TOKEN_CHARACTERS + 1), attestation.requestId)).rejects.toThrow(
      'size bound',
    );
    await expect(f.verify(await f.sign(), 'invalid request')).rejects.toThrow('canonical');
  });
});

describe('canonical time evidence', () => {
  it.each([null, [], 12, 'text', {}, { version: 'another' }])(
    'refuses malformed claims: %j',
    async (value: unknown) => {
      const f = await fixture();
      await expect(f.verify(await f.sign(JSON.stringify(value)), attestation.requestId)).rejects.toThrow(RangeError);
    },
  );

  it.each([-1, 0.5, NaN, Infinity, 8_640_000_000_000_001])('refuses an invalid timestamp: %s', (serverTime) => {
    expect(() => licenseTimePayload({ ...attestation, serverTime })).toThrow(RangeError);
  });

  it('retains exact supported boundaries', async () => {
    const f = await fixture();
    await Promise.all(
      [0, 8_640_000_000_000_000].map(async (serverTime) => {
        const value = { ...attestation, serverTime };
        expect(await f.verify(await f.sign(licenseTimePayload(value)), value.requestId)).toEqual(value);
      }),
    );
  });

  it('refuses extra content, whitespace and a byte-order mark even with a valid signature', async () => {
    const f = await fixture();
    const canonical = licenseTimePayload(attestation);
    await Promise.all(
      [
        ` ${canonical}`,
        `\uFEFF${canonical}`,
        JSON.stringify({ version: 'auto.license-time.v1', ...attestation, businessData: 'not permitted' }),
      ].map(async (payload) => {
        await expect(f.verify(await f.sign(payload), attestation.requestId)).rejects.toThrow(Error);
      }),
    );
  });
});
