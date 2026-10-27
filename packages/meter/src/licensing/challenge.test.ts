import type { InstallationChallenge } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import { licenseFixture } from '../testing/license-fixture.ts';

describe('license challenge intent and authority', () => {
  it.each<Partial<InstallationChallenge>>([
    { id: 'another-challenge' },
    { requestDigest: 'b'.repeat(64) },
    { purpose: 'refresh' },
    { issuer: 'https://another.auto.test' },
    { ring: 'production' },
    { clusterId: 'another-cluster' },
    { installationKeyDigest: 'b'.repeat(64) },
    { accountId: 'another-account' },
  ])('refuses a changed activation response: %j', async (changed) => {
    const f = await licenseFixture();
    f.respond({ ...(await f.challenge()), ...changed });
    await expect(f.protocol.activationChallenge('request-1', 'activation-secret')).rejects.toThrow(
      'license_challenge_mismatch',
    );
  });

  it('refuses a response from a different request or installation and a refresh returned for activation', async () => {
    const f = await licenseFixture();
    f.respond(await f.challenge());
    await expect(f.protocol.activationChallenge('another-request', 'activation-secret')).rejects.toThrow(
      'license_challenge_mismatch',
    );
    f.respond(await f.challenge('refresh'));
    await expect(f.protocol.activationChallenge('request-1', 'activation-secret')).rejects.toThrow(
      'license_challenge_mismatch',
    );
    await expect(f.protocol.refreshChallenge('request-1', 'another-installation')).rejects.toThrow(
      'license_challenge_mismatch',
    );
  });
});

describe('a stored challenge submitted for completion', () => {
  it.each<Partial<InstallationChallenge>>([
    { issuer: 'https://another.auto.test' },
    { ring: 'production' },
    { clusterId: 'another-cluster' },
    { installationKeyDigest: 'b'.repeat(64) },
  ])('refuses a changed stored challenge before signing or sending it: %j', async (changed) => {
    const f = await licenseFixture();
    await expect(f.protocol.complete({ ...(await f.challenge()), ...changed }, 5000)).rejects.toThrow(
      'license_challenge_mismatch',
    );
    expect(f.requests).toHaveLength(0);
  });

  it('refuses a malformed challenge shape and a noncanonical or unbounded nonce window', async () => {
    const f = await licenseFixture();
    f.respond({ id: 'incomplete' });
    await expect(f.protocol.activationChallenge('request-1', 'activation-secret')).rejects.toThrow(/Missing|Expected/u);
    await expect(f.protocol.complete({ ...(await f.challenge()), nonce: 'not-a-nonce' }, 5000)).rejects.toThrow(
      'nonce',
    );
    await expect(f.protocol.complete({ ...(await f.challenge()), expiresAt: 400_000 }, 5000)).rejects.toThrow(
      'five minutes',
    );
  });
});
