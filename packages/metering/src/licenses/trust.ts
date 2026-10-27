import { createLocalJWKSet } from 'jose';

import { ed25519PublicX, licenseIdentifier, licenseIssuer, licenseRing } from './claim-values.ts';
import type { LicenseTrust } from './entitlements.ts';

export function trustedKeys(trust: LicenseTrust): ReturnType<typeof createLocalJWKSet> {
  licenseIssuer(trust.issuer);
  licenseRing(trust.ring);
  if (
    trust.keys.length === 0 ||
    trust.keys.length > 8 ||
    new Set(trust.keys.map((key) => key.keyId)).size !== trust.keys.length
  ) {
    throw new RangeError('License trust requires distinct, bounded public keys');
  }
  return createLocalJWKSet({
    keys: trust.keys.map((key) => ({
      kty: 'OKP',
      crv: 'Ed25519',
      alg: 'EdDSA',
      use: 'sig',
      kid: licenseIdentifier(key.keyId),
      x: ed25519PublicX(key.x),
    })),
  });
}
