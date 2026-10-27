import { base64url, compactVerify, importJWK } from 'jose';

import { licenseDigest, licenseIdentifier, licenseInteger, licenseIssuer, licenseRing } from './claim-values.ts';
import type { InstallationBinding, LicenseRing } from './entitlements.ts';
import { installationKeyFingerprint, readInstallationPublicKey } from './installation-keys.ts';

export const INSTALLATION_PROOF_TYPE = 'auto-installation-proof+jws';
export const INSTALLATION_CHALLENGE_MILLISECONDS = 300_000;

export interface InstallationChallenge extends InstallationBinding {
  readonly id: string;
  readonly issuer: string;
  readonly ring: LicenseRing;
  readonly purpose: 'activate' | 'refresh';
  readonly licenseId: string;
  readonly generation: number;
  readonly nonce: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly requestDigest: string;
}

function nonceValue(value: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value) || base64url.encode(base64url.decode(value)) !== value) {
    throw new RangeError('An installation challenge requires a canonical random nonce');
  }
  return value;
}

function challengeTiming(challenge: InstallationChallenge): void {
  licenseInteger(challenge.createdAt);
  licenseInteger(challenge.expiresAt);
  const duration = challenge.expiresAt - challenge.createdAt;
  if (duration <= 0 || duration > INSTALLATION_CHALLENGE_MILLISECONDS) {
    throw new RangeError('An installation challenge is valid for at most five minutes');
  }
}

function challengePurpose(value: unknown): InstallationChallenge['purpose'] {
  if (value !== 'activate' && value !== 'refresh')
    throw new RangeError('The installation challenge purpose is unsupported');
  return value;
}

export function installationProofPayload(challenge: InstallationChallenge): string {
  challengeTiming(challenge);
  return JSON.stringify({
    version: 'auto.installation-proof.v1',
    purpose: challengePurpose(challenge.purpose),
    issuer: licenseIssuer(challenge.issuer),
    ring: licenseRing(challenge.ring),
    id: licenseIdentifier(challenge.id),
    accountId: licenseIdentifier(challenge.accountId),
    installationId: licenseIdentifier(challenge.installationId),
    clusterId: licenseIdentifier(challenge.clusterId),
    installationKeyDigest: licenseDigest(challenge.installationKeyDigest),
    licenseId: licenseIdentifier(challenge.licenseId),
    generation: licenseInteger(challenge.generation),
    nonce: nonceValue(challenge.nonce),
    createdAt: challenge.createdAt,
    expiresAt: challenge.expiresAt,
    requestDigest: licenseDigest(challenge.requestDigest),
  });
}

export async function verifyInstallationProof(
  proof: string,
  challenge: InstallationChallenge,
  publicKey: unknown,
  now: number,
): Promise<void> {
  const expectedPayload = installationProofPayload(challenge);
  licenseInteger(now);
  if (now < challenge.createdAt || now >= challenge.expiresAt || proof.length > 8192) {
    throw new RangeError('The installation proof is expired, premature or oversized');
  }
  const key = readInstallationPublicKey(publicKey);
  const fingerprint = await installationKeyFingerprint(key);
  if (fingerprint !== challenge.installationKeyDigest) {
    throw new RangeError('The challenge belongs to another installation public key');
  }
  const { protectedHeader, payload } = await compactVerify(proof, await importJWK({ ...key }, 'EdDSA'), {
    algorithms: ['EdDSA'],
  });
  if (
    protectedHeader.typ !== INSTALLATION_PROOF_TYPE ||
    protectedHeader.kid !== fingerprint ||
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payload) !== expectedPayload
  ) {
    throw new RangeError('The installation proof does not match its type, key or challenge');
  }
}
