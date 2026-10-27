import {
  INSTALLATION_CHALLENGE_MILLISECONDS,
  LICENSE_TOKEN_TYPE,
  LICENSE_TIME_TYPE,
  STANDARD_OFFLINE_MILLISECONDS,
  installationRequestIdentity,
  licenseClaims,
  licenseEntitlementSerial,
  licenseTimePayload,
  readInstallationPublicKey,
  type InstallationChallenge,
  type LicenseEntitlement,
  type LicenseTrust,
} from '@on.auto/metering';
import { CompactSign, exportJWK, generateKeyPair, SignJWT } from 'jose';

import { licenseProtocol, openInstallation, type InstallationIdentity } from '../index.ts';
import { sqliteDatabase } from './sqlite-database.ts';

function challengesFor(trust: LicenseTrust, installation: InstallationIdentity) {
  return async function challenge(
    purpose: InstallationChallenge['purpose'] = 'activate',
    requestId = 'request-1',
    licenseId = 'license-1',
  ): Promise<InstallationChallenge> {
    const intent = {
      issuer: trust.issuer,
      ring: trust.ring,
      purpose,
      requestId,
      accountId: 'account-1',
      installationId: 'installation-1',
      licenseId,
      clusterId: installation.clusterId,
      installationKeyDigest: installation.installationKeyDigest,
    };
    const identity = await installationRequestIdentity(intent);
    return {
      ...intent,
      id: identity.challengeId,
      requestDigest: identity.requestDigest,
      generation: 0,
      nonce: 'A'.repeat(43),
      createdAt: 5000,
      expiresAt: 5000 + INSTALLATION_CHALLENGE_MILLISECONDS,
    };
  };
}

function bundlesFor(sign: (license: LicenseEntitlement) => Promise<string>) {
  return async function bundle(
    completed: InstallationChallenge,
    changes: Partial<LicenseEntitlement> = {},
    allocationTokens: readonly string[] = [],
  ) {
    const issuedAt = changes.issuedAt ?? 5000;
    const license: LicenseEntitlement = {
      issuer: completed.issuer,
      ring: completed.ring,
      accountId: completed.accountId,
      installationId: completed.installationId,
      licenseId: completed.licenseId,
      clusterId: completed.clusterId,
      installationKeyDigest: completed.installationKeyDigest,
      customerId: 'customer-1',
      serial: await licenseEntitlementSerial(completed.accountId, completed.id),
      generation: completed.generation + 1,
      plan: 'free',
      mode: 'standard',
      capabilities: ['reasoning', 'prediction'],
      issuedAt,
      notBefore: issuedAt,
      refreshAfter: issuedAt + 86_400_000,
      expiresAt: issuedAt + STANDARD_OFFLINE_MILLISECONDS,
      offlineDeadline: issuedAt + STANDARD_OFFLINE_MILLISECONDS,
      allocationIds: [],
      grantIds: [],
      ...changes,
    };
    const entitlementToken = await sign(license);
    return { entitlementToken, allocationTokens, license };
  };
}

export async function licenseFixture(open = sqliteDatabase) {
  const database = await open();
  const installation = await openInstallation(database);
  const keys = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  const publicKey = readInstallationPublicKey(await exportJWK(keys.publicKey));
  const trust: LicenseTrust = {
    issuer: 'https://accounts.auto.test',
    ring: 'local',
    keys: [{ keyId: 'authority-key', x: publicKey.x }],
  };
  const state: { answer: unknown } = { answer: {} };
  const requests: Readonly<Request>[] = [];
  const protocol = licenseProtocol({
    trust,
    installation,
    monotonicTime: () => 0,
    fetch: (request) => {
      requests.push(request);
      return Promise.resolve(Response.json(state.answer));
    },
  });
  return {
    database,
    installation,
    trust,
    protocol,
    timeToken: (requestId: string, serverTime: number) =>
      new CompactSign(new TextEncoder().encode(licenseTimePayload({ ...trust, requestId, serverTime })))
        .setProtectedHeader({ alg: 'EdDSA', typ: LICENSE_TIME_TYPE, kid: 'authority-key' })
        .sign(keys.privateKey),
    requests,
    challenge: challengesFor(trust, installation),
    bundle: bundlesFor((license) =>
      new SignJWT(licenseClaims(license))
        .setProtectedHeader({ alg: 'EdDSA', typ: LICENSE_TOKEN_TYPE, kid: 'authority-key' })
        .sign(keys.privateKey),
    ),
    respond: (value: unknown) => {
      state.answer = value;
    },
  };
}
