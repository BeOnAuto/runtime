import { createLocalJWKSet, jwtVerify } from 'jose';

import { ed25519PublicX, licenseIdentifier, licenseInteger, licenseIssuer, licenseRing } from './claim-values.ts';
import { readLicenseClaims } from './claims.ts';
import {
  LICENSE_AUDIENCE,
  LICENSE_TOKEN_TYPE,
  MOST_LICENSE_TOKEN_CHARACTERS,
  type ExpectedLicense,
  type LicenseEntitlement,
  type LicenseTrust,
} from './entitlements.ts';

function trustedKeys(trust: LicenseTrust): ReturnType<typeof createLocalJWKSet> {
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

function assertBinding(entitlement: LicenseEntitlement, expected: ExpectedLicense, ring: string): void {
  const binding = expected.binding;
  if (
    entitlement.accountId !== binding.accountId ||
    entitlement.installationId !== binding.installationId ||
    entitlement.clusterId !== binding.clusterId ||
    entitlement.installationKeyDigest !== binding.installationKeyDigest ||
    entitlement.ring !== ring
  ) {
    throw new RangeError('The license belongs to another account, installation, cluster, key or ring');
  }
  if (
    entitlement.issuedAt > expected.now ||
    entitlement.offlineDeadline <= expected.now ||
    entitlement.generation < expected.minimumGeneration
  ) {
    throw new RangeError('The license is stale or outside its trusted time');
  }
}

export function licenseVerifier(
  trust: LicenseTrust,
): (token: string, expected: ExpectedLicense) => Promise<LicenseEntitlement> {
  const keySet = trustedKeys(trust);
  const { issuer, ring } = trust;
  return async (token, expected) => {
    if (token.length > MOST_LICENSE_TOKEN_CHARACTERS) {
      throw new RangeError('The license token exceeds its size bound');
    }
    licenseInteger(expected.now);
    licenseInteger(expected.minimumGeneration);
    if (expected.now > 8_640_000_000_000_000)
      throw new RangeError('The trusted license clock is outside the supported date range');
    const { payload, protectedHeader } = await jwtVerify(token, keySet, {
      algorithms: ['EdDSA'],
      issuer,
      audience: LICENSE_AUDIENCE,
      typ: LICENSE_TOKEN_TYPE,
      requiredClaims: ['iss', 'aud', 'sub', 'iat', 'nbf', 'exp', 'jti'],
      clockTolerance: 0,
      currentDate: new Date(expected.now),
    });
    if (protectedHeader.kid === undefined) throw new RangeError('The license must name its trusted signing key');
    const entitlement = readLicenseClaims(payload);
    assertBinding(entitlement, expected, ring);
    return entitlement;
  };
}
