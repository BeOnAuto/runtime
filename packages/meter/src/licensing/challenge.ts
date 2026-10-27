import {
  installationProofPayload,
  installationRequestIdentity,
  type InstallationChallenge,
  type LicenseTrust,
} from '@on.auto/metering';
import { Schema } from 'effect';

import type { InstallationIdentity } from '../installation/records.ts';

const challengeBody = Schema.decodeUnknownSync(
  Schema.Struct({
    id: Schema.String,
    issuer: Schema.String,
    ring: Schema.Literals(['local', 'production']),
    purpose: Schema.Literals(['activate', 'refresh']),
    accountId: Schema.String,
    installationId: Schema.String,
    clusterId: Schema.String,
    installationKeyDigest: Schema.String,
    licenseId: Schema.String,
    generation: Schema.Number,
    nonce: Schema.String,
    createdAt: Schema.Number,
    expiresAt: Schema.Number,
    requestDigest: Schema.String,
  }),
);

export function assertChallengeAuthority(
  challenge: InstallationChallenge,
  trust: LicenseTrust,
  installation: InstallationIdentity,
): void {
  installationProofPayload(challenge);
  if (
    challenge.issuer !== trust.issuer ||
    challenge.ring !== trust.ring ||
    challenge.clusterId !== installation.clusterId ||
    challenge.installationKeyDigest !== installation.installationKeyDigest
  )
    throw new Error('license_challenge_mismatch');
}

export async function challengeForRequest(
  value: unknown,
  request: Readonly<{ requestId: string; purpose: InstallationChallenge['purpose'] }>,
): Promise<InstallationChallenge> {
  const challenge = challengeBody(value);
  const expected = await installationRequestIdentity({ ...challenge, requestId: request.requestId });
  if (
    challenge.purpose !== request.purpose ||
    challenge.id !== expected.challengeId ||
    challenge.requestDigest !== expected.requestDigest
  )
    throw new Error('license_challenge_mismatch');
  return challenge;
}
