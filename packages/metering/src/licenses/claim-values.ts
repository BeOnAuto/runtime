import { base64url } from 'jose';

import type { LicenseCapability, LicenseMode, LicensePlan, LicenseRing } from './entitlements.ts';

type Claims = Readonly<Record<string, unknown>>;

export function licenseIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/u.test(value)) {
    throw new RangeError('A license identifier must be bounded and canonical');
  }
  return value;
}

export function licenseInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('A license counter or time must be a safe non-negative integer');
  }
  return value;
}

export function licenseTime(value: unknown): number {
  const milliseconds = licenseInteger(value) * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds > 8_640_000_000_000_000) {
    throw new RangeError('A license timestamp is outside the supported date range');
  }
  return milliseconds;
}

export function licenseIssuer(value: unknown): string {
  if (typeof value !== 'string' || !URL.canParse(value)) {
    throw new RangeError('A license issuer must be an HTTPS address');
  }
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new RangeError('A license issuer must be an HTTPS address');
  }
  return value;
}

export function licenseDigest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new RangeError('The installation key requires its canonical SHA-256 fingerprint');
  }
  return value;
}

export function licenseReferences(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new RangeError('License references must be a bounded list');
  }
  const identifiers = value.map((entry: unknown) => licenseIdentifier(entry));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new RangeError('License references cannot repeat');
  }
  return identifiers;
}

const capabilities: readonly LicenseCapability[] = [
  'reasoning',
  'interaction',
  'prediction',
  'recall',
  'computation',
  'coordination',
];

function isCapability(value: unknown): value is LicenseCapability {
  return capabilities.some((capability) => capability === value);
}

export function licenseCapabilities(value: unknown): readonly LicenseCapability[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((entry: unknown) => isCapability(entry))) {
    throw new RangeError('License capabilities must name supported protected work');
  }
  if (new Set(value).size !== value.length) {
    throw new RangeError('License capabilities cannot repeat');
  }
  return value;
}

export function licensePlan(value: unknown): LicensePlan {
  if (value !== 'free' && value !== 'starter' && value !== 'team' && value !== 'custom' && value !== 'enterprise') {
    throw new RangeError('The license plan is unsupported');
  }
  return value;
}

export function licenseRing(value: unknown): LicenseRing {
  if (value !== 'local' && value !== 'production') {
    throw new RangeError('The license ring is unsupported');
  }
  return value;
}

export function licenseMode(value: unknown): LicenseMode {
  if (value !== 'standard' && value !== 'enterprise-offline') {
    throw new RangeError('The license mode is unsupported');
  }
  return value;
}

export function ed25519PublicX(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new RangeError('A license public key must be an Ed25519 key');
  }
  if (base64url.encode(base64url.decode(value)) !== value) {
    throw new RangeError('A license public key must use canonical base64url');
  }
  return value;
}

export function numericDate(milliseconds: number): number {
  const seconds = licenseInteger(milliseconds) / 1000;
  if (!Number.isInteger(seconds)) {
    throw new RangeError('License timestamps must resolve to whole seconds');
  }
  return seconds;
}

export function licenseVersions(claims: Claims, versions: Claims): void {
  if (Object.entries(versions).some(([key, value]: readonly [string, unknown]) => claims[key] !== value)) {
    throw new RangeError('The license version, audience, tariff or policy is unsupported');
  }
}
