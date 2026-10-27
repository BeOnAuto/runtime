import {
  INSTALLATION_PROOF_TYPE,
  OFFLINE_REPORT_TYPE,
  installationKeyFingerprint,
  installationProofPayload,
  readInstallationPublicKey,
  usageReportPayload,
} from '@on.auto/metering';
import type { SecretStore } from '@on.auto/secrets';
import { Effect, Redacted } from 'effect';
import { CompactSign, compactVerify, exportJWK, exportPKCS8, generateKeyPair, importJWK, importPKCS8 } from 'jose';

import type { InstallationIdentity, InstallationSigner, StoredIdentity } from './records.ts';

export async function createIdentity(secrets: SecretStore): Promise<StoredIdentity> {
  const keys = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const publicKey = readInstallationPublicKey(await exportJWK(keys.publicKey));
  return {
    clusterId: crypto.randomUUID(),
    publicKey,
    installationKeyDigest: await installationKeyFingerprint(publicKey),
    secretId: await Effect.runPromise(secrets.keep(Redacted.make(await exportPKCS8(keys.privateKey)))),
  };
}

function boundPayload(
  identity: InstallationIdentity,
  value: Pick<InstallationIdentity, 'clusterId' | 'installationKeyDigest'>,
): void {
  if (value.clusterId !== identity.clusterId || value.installationKeyDigest !== identity.installationKeyDigest)
    throw new Error('installation_binding_mismatch');
}

export async function identitySigner(secrets: SecretStore, identity: StoredIdentity): Promise<InstallationSigner> {
  const stored = await Effect.runPromise(secrets.read(identity.secretId));
  if (stored === undefined) throw new Error('installation_key_unavailable');
  const key = await importPKCS8(Redacted.value(stored.value), 'EdDSA');
  const sign = (payload: string, type: string) =>
    new CompactSign(new TextEncoder().encode(payload))
      .setProtectedHeader({ alg: 'EdDSA', typ: type, kid: identity.installationKeyDigest })
      .sign(key);
  await compactVerify(
    await sign(identity.clusterId, 'auto-installation-key-check'),
    await importJWK(identity.publicKey, 'EdDSA'),
    { algorithms: ['EdDSA'] },
  );
  return {
    clusterId: identity.clusterId,
    publicKey: identity.publicKey,
    installationKeyDigest: identity.installationKeyDigest,
    proveChallenge: (challenge) => {
      boundPayload(identity, challenge);
      return sign(installationProofPayload(challenge), INSTALLATION_PROOF_TYPE);
    },
    signReport: (report) => {
      boundPayload(identity, report);
      return sign(usageReportPayload(report), OFFLINE_REPORT_TYPE);
    },
  };
}
