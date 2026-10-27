import { licenseDigest, licenseIdentifier, licenseIssuer, licenseRing } from './claim-values.ts';
import type { InstallationBinding, LicenseRing } from './entitlements.ts';

export interface InstallationIntent extends InstallationBinding {
  readonly issuer: string;
  readonly ring: LicenseRing;
  readonly purpose: 'activate' | 'refresh';
  readonly requestId: string;
  readonly licenseId: string;
}

async function identityHash(fields: readonly string[]): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fields))));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function installationRequestIdentity(
  intent: InstallationIntent,
): Promise<Readonly<{ challengeId: string; requestDigest: string }>> {
  if (intent.purpose !== 'activate' && intent.purpose !== 'refresh')
    throw new RangeError('The installation purpose is unsupported');
  const fields = [
    'installation-challenge.v1',
    licenseIssuer(intent.issuer),
    licenseRing(intent.ring),
    intent.purpose,
    licenseIdentifier(intent.requestId),
    licenseIdentifier(intent.accountId),
    licenseIdentifier(intent.installationId),
    licenseIdentifier(intent.licenseId),
    licenseIdentifier(intent.clusterId),
    licenseDigest(intent.installationKeyDigest),
  ];
  return {
    challengeId: `challenge_${await identityHash([intent.installationId, intent.purpose, intent.requestId])}`,
    requestDigest: await identityHash(fields),
  };
}

export async function licenseEntitlementSerial(accountId: string, challengeId: string): Promise<string> {
  return `entitlement_${await identityHash([licenseIdentifier(accountId), licenseIdentifier(challengeId)])}`;
}
