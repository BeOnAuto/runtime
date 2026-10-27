import { licenseIdentifier, licenseInteger, licenseIssuer, licenseRing } from '../licenses/claim-values.ts';
import type { LicenseRing } from '../licenses/entitlements.ts';

export const LICENSE_TIME_TYPE = 'auto-license-time+jws';
export const MOST_TIME_TOKEN_CHARACTERS = 4096;

export interface LicenseTimeAttestation {
  readonly issuer: string;
  readonly ring: LicenseRing;
  readonly requestId: string;
  readonly serverTime: number;
}

export function readTimeAttestation(value: unknown): LicenseTimeAttestation {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new RangeError('A license time attestation must contain an object');
  const claims: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  if (claims['version'] !== 'auto.license-time.v1') throw new RangeError('The license time version is unsupported');
  const serverTime = licenseInteger(claims['serverTime']);
  if (serverTime > 8_640_000_000_000_000) throw new RangeError('The license time is outside the supported date range');
  return {
    issuer: licenseIssuer(claims['issuer']),
    ring: licenseRing(claims['ring']),
    requestId: licenseIdentifier(claims['requestId']),
    serverTime,
  };
}

export function licenseTimePayload(attestation: LicenseTimeAttestation): string {
  const value = { version: 'auto.license-time.v1', ...attestation };
  const checked = readTimeAttestation(value);
  return JSON.stringify({ version: value.version, ...checked });
}
