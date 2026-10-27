import { base64url, calculateJwkThumbprint } from 'jose';
import { describe, expect, it } from 'vitest';

import { installationKeyFingerprint, readInstallationPublicKey } from '../index.ts';

const publicKey = { kty: 'OKP', crv: 'Ed25519', x: 'A'.repeat(43) };

describe('installation public key evidence', () => {
  it('uses the canonical public JWK thumbprint, represented as a SHA-256 hex digest', async () => {
    const fingerprint = await installationKeyFingerprint(publicKey);
    const expected = Array.from(base64url.decode(await calculateJwkThumbprint(publicKey)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    expect(fingerprint).toBe(expected);
    expect(await installationKeyFingerprint({ x: publicKey.x, crv: 'Ed25519', kty: 'OKP' })).toBe(fingerprint);
    expect(readInstallationPublicKey(publicKey)).toEqual(publicKey);
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { ...publicKey, kty: 'RSA' },
    { ...publicKey, crv: 'Ed448' },
    { ...publicKey, d: 'private-material' },
    { ...publicKey, extra: true },
  ])('refuses non-public or unsupported key material %j', (value) => {
    expect(() => readInstallationPublicKey(value)).toThrow('contain only public coordinates');
  });

  it('refuses missing and noncanonical public coordinates', () => {
    expect(() => readInstallationPublicKey({ kty: 'OKP', crv: 'Ed25519' })).toThrow('Ed25519 key');
    expect(() => readInstallationPublicKey({ ...publicKey, x: `${'A'.repeat(42)}B` })).toThrow('canonical base64url');
  });
});
