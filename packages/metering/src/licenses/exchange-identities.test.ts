import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  installationRequestIdentity,
  licenseEntitlementSerial,
  type InstallationIntent,
} from './exchange-identities.ts';

const intent: InstallationIntent = {
  issuer: 'https://accounts.auto.test',
  ring: 'local',
  purpose: 'activate',
  requestId: 'request-1',
  accountId: 'account-1',
  installationId: 'installation-1',
  licenseId: 'license-1',
  clusterId: 'cluster-1',
  installationKeyDigest: 'a'.repeat(64),
};

describe('the durable identity of a license exchange', () => {
  it('binds the challenge and request fingerprint to the exact canonical intent', async () => {
    const expectedChallenge = createHash('sha256').update('["installation-1","activate","request-1"]').digest('hex');
    const expectedRequest = createHash('sha256')
      .update(
        `["installation-challenge.v1","https://accounts.auto.test","local","activate","request-1","account-1","installation-1","license-1","cluster-1","${'a'.repeat(64)}"]`,
      )
      .digest('hex');
    expect(await installationRequestIdentity(intent)).toEqual({
      challengeId: `challenge_${expectedChallenge}`,
      requestDigest: expectedRequest,
    });
    expect(await installationRequestIdentity({ ...intent })).toEqual(await installationRequestIdentity(intent));
  });

  it('binds a serial to its account and challenge without ambiguous string concatenation', async () => {
    const expected = createHash('sha256').update('["account-1","challenge-1"]').digest('hex');
    expect(await licenseEntitlementSerial('account-1', 'challenge-1')).toBe(`entitlement_${expected}`);
    expect(await licenseEntitlementSerial('account-1', 'challenge-1')).not.toBe(
      await licenseEntitlementSerial('account-2', 'challenge-1'),
    );
    expect(await licenseEntitlementSerial('account-1', 'challenge-1')).not.toBe(
      await licenseEntitlementSerial('account-1', 'challenge-2'),
    );
    expect(await licenseEntitlementSerial('a', 'bc')).not.toBe(await licenseEntitlementSerial('ab', 'c'));
  });
});

describe('changed or invalid license intent', () => {
  it.each<Partial<InstallationIntent>>([
    { issuer: 'https://another.auto.test' },
    { ring: 'production' },
    { purpose: 'refresh' },
    { requestId: 'request-2' },
    { accountId: 'account-2' },
    { installationId: 'installation-2' },
    { licenseId: 'license-2' },
    { clusterId: 'cluster-2' },
    { installationKeyDigest: 'b'.repeat(64) },
  ])('changes the fingerprint when any intent field changes: %j', async (changed) => {
    expect((await installationRequestIdentity({ ...intent, ...changed })).requestDigest).not.toBe(
      (await installationRequestIdentity(intent)).requestDigest,
    );
  });

  it('refuses a noncanonical identifier before hashing', async () => {
    await expect(installationRequestIdentity({ ...intent, requestId: 'request with spaces' })).rejects.toThrow(
      'canonical',
    );
    await expect(licenseEntitlementSerial('', 'challenge-1')).rejects.toThrow('canonical');
  });

  it('refuses an unsupported purpose received from an untyped caller', async () => {
    const invalid: unknown = { ...intent, purpose: 'anything' };
    await expect(Reflect.apply(installationRequestIdentity, undefined, [invalid])).rejects.toThrow('purpose');
  });
});
