export const LICENSE_VERSION = 'auto.license.v1';
export const LICENSE_POLICY_VERSION = '2026-10-26.v4';
export const LICENSE_TOKEN_TYPE = 'auto-license+jwt';
export const LICENSE_AUDIENCE = 'auto-runtime-license';
export const STANDARD_OFFLINE_MILLISECONDS = 7 * 86_400_000;
export const MOST_LICENSE_TOKEN_CHARACTERS = 16_384;

export type LicensePlan = 'free' | 'starter' | 'team' | 'custom' | 'enterprise';
export type LicenseRing = 'local' | 'production';
export type LicenseMode = 'standard' | 'enterprise-offline';
export type LicenseCapability = 'reasoning' | 'interaction' | 'prediction' | 'recall' | 'computation' | 'coordination';

export interface InstallationBinding {
  readonly accountId: string;
  readonly installationId: string;
  readonly clusterId: string;
  readonly installationKeyDigest: string;
}

interface EntitlementTimes {
  readonly issuedAt: number;
  readonly notBefore: number;
  readonly expiresAt: number;
  readonly refreshAfter: number;
  readonly offlineDeadline: number;
}

export interface LicenseEntitlement extends InstallationBinding, EntitlementTimes {
  readonly issuer: string;
  readonly customerId: string;
  readonly licenseId: string;
  readonly serial: string;
  readonly ring: LicenseRing;
  readonly plan: LicensePlan;
  readonly mode: LicenseMode;
  readonly generation: number;
  readonly capabilities: readonly LicenseCapability[];
  readonly allocationIds: readonly string[];
  readonly grantIds: readonly string[];
}

export interface TrustedLicenseKey {
  readonly keyId: string;
  readonly x: string;
}

export interface LicenseTrust {
  readonly issuer: string;
  readonly ring: LicenseRing;
  readonly keys: readonly TrustedLicenseKey[];
}

export interface ExpectedLicense {
  readonly binding: InstallationBinding;
  readonly now: number;
  readonly minimumGeneration: number;
}
