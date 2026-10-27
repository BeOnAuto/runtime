import { CompactSign, errors, exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  INSTALLATION_PROOF_TYPE,
  installationKeyFingerprint,
  installationProofPayload,
  readInstallationPublicKey,
  verifyInstallationProof,
  type InstallationChallenge,
} from '../index.ts';

async function proofFixture() {
  const pair = await generateKeyPair('EdDSA');
  const publicKey = readInstallationPublicKey(await exportJWK(pair.publicKey));
  const fingerprint = await installationKeyFingerprint(publicKey);
  const challenge: InstallationChallenge = {
    id: 'challenge',
    issuer: 'https://licenses.auto.test',
    ring: 'local',
    purpose: 'activate',
    accountId: 'account',
    installationId: 'installation',
    clusterId: 'cluster',
    installationKeyDigest: fingerprint,
    licenseId: 'key',
    generation: 0,
    nonce: 'A'.repeat(43),
    createdAt: 1000,
    expiresAt: 301_000,
    requestDigest: 'a'.repeat(64),
  };
  const normalHeader = { alg: 'EdDSA', typ: INSTALLATION_PROOF_TYPE, kid: fingerprint };
  function sign(
    payload = installationProofPayload(challenge),
    header: Readonly<{ alg: string; typ?: string; kid?: string }> = normalHeader,
  ) {
    return new CompactSign(new TextEncoder().encode(payload)).setProtectedHeader(header).sign(pair.privateKey);
  }
  return { challenge, publicKey, sign, normalHeader };
}

describe('installation proof of key possession', () => {
  it('binds a canonical challenge to possession of the installation private key', async () => {
    const fixture = await proofFixture();
    const proof = await fixture.sign();
    await expect(verifyInstallationProof(proof, fixture.challenge, fixture.publicKey, 2000)).resolves.toBeUndefined();
    expect(JSON.parse(installationProofPayload(fixture.challenge))).toMatchObject({
      version: 'auto.installation-proof.v1',
      purpose: 'activate',
    });
    const refresh: InstallationChallenge = { ...fixture.challenge, purpose: 'refresh' };
    await expect(
      verifyInstallationProof(await fixture.sign(installationProofPayload(refresh)), refresh, fixture.publicKey, 2000),
    ).resolves.toBeUndefined();
  });

  it('refuses an unrelated public key and a forged signature', async () => {
    const fixture = await proofFixture();
    const other = await proofFixture();
    await expect(
      verifyInstallationProof(await fixture.sign(), fixture.challenge, other.publicKey, 2000),
    ).rejects.toThrow('another installation public key');
    await expect(
      verifyInstallationProof(await other.sign(), fixture.challenge, fixture.publicKey, 2000),
    ).rejects.toThrow(errors.JWSSignatureVerificationFailed);
  });

  it.each(['id', 'clusterId', 'accountId', 'installationId', 'requestDigest'])(
    'cannot reuse the proof for another %s',
    async (field) => {
      const fixture = await proofFixture();
      const altered = { ...fixture.challenge, [field]: 'b'.repeat(64) };
      await expect(verifyInstallationProof(await fixture.sign(), altered, fixture.publicKey, 2000)).rejects.toThrow(
        'does not match',
      );
    },
  );
});

describe('installation proof limits and type', () => {
  it.each([999, 301_000])('rejects a proof outside its five-minute window at %s', async (now) => {
    const fixture = await proofFixture();
    await expect(
      verifyInstallationProof(await fixture.sign(), fixture.challenge, fixture.publicKey, now),
    ).rejects.toThrow('expired, premature');
  });

  it('bounds proof bytes and refuses invalid clocks', async () => {
    const fixture = await proofFixture();
    await expect(verifyInstallationProof('x'.repeat(8193), fixture.challenge, fixture.publicKey, 2000)).rejects.toThrow(
      'oversized',
    );
    await expect(verifyInstallationProof('', fixture.challenge, fixture.publicKey, -1)).rejects.toThrow(
      'safe non-negative',
    );
  });

  it('refuses a different proof type, a missing fingerprint or a different signed payload', async () => {
    const fixture = await proofFixture();
    const payload = installationProofPayload(fixture.challenge);
    const wrongType = await fixture.sign(payload, { ...fixture.normalHeader, typ: 'JWT' });
    const noFingerprint = await fixture.sign(payload, { alg: 'EdDSA', typ: INSTALLATION_PROOF_TYPE });
    await expect(verifyInstallationProof(wrongType, fixture.challenge, fixture.publicKey, 2000)).rejects.toThrow(
      'does not match',
    );
    await expect(verifyInstallationProof(noFingerprint, fixture.challenge, fixture.publicKey, 2000)).rejects.toThrow(
      'does not match',
    );
    await expect(
      verifyInstallationProof(await fixture.sign('another payload'), fixture.challenge, fixture.publicKey, 2000),
    ).rejects.toThrow('does not match');
  });
});

describe('installation challenge validation', () => {
  it.each(['purpose'])('refuses an unsupported %s', async (field) => {
    const { challenge } = await proofFixture();
    expect(() => installationProofPayload({ ...challenge, [field]: 'unsupported' })).toThrow('purpose is unsupported');
  });

  it('requires a positive lifetime no greater than five minutes', async () => {
    const { challenge } = await proofFixture();
    for (const expiresAt of [challenge.createdAt, challenge.expiresAt + 1])
      expect(() => installationProofPayload({ ...challenge, expiresAt })).toThrow('at most five minutes');
  });

  it('refuses malformed or noncanonical nonces', async () => {
    const { challenge } = await proofFixture();
    for (const nonce of ['', `${'A'.repeat(42)}B`])
      expect(() => installationProofPayload({ ...challenge, nonce })).toThrow('canonical random nonce');
  });
});
