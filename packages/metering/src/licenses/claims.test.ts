import { describe, expect, it } from 'vitest';

import {
  licenseClaims,
  readLicenseClaims,
  STANDARD_OFFLINE_MILLISECONDS,
  type LicenseEntitlement,
  type LicensePlan,
} from '../index.ts';

const issuedAt = Date.UTC(2026, 9, 26);
const day = 86_400_000;
const entitlement: LicenseEntitlement = {
  issuer: 'https://licenses.auto.test',
  accountId: 'account',
  customerId: 'customer',
  licenseId: 'key',
  installationId: 'installation',
  clusterId: 'cluster',
  installationKeyDigest: 'a'.repeat(64),
  serial: 'serial',
  ring: 'local',
  plan: 'free',
  mode: 'standard',
  generation: 1,
  issuedAt,
  notBefore: issuedAt,
  expiresAt: issuedAt + STANDARD_OFFLINE_MILLISECONDS,
  refreshAfter: issuedAt + day,
  offlineDeadline: issuedAt + STANDARD_OFFLINE_MILLISECONDS,
  capabilities: ['reasoning', 'interaction', 'prediction', 'recall', 'computation', 'coordination'],
  allocationIds: ['allocation'],
  grantIds: ['grant'],
};
const claims = licenseClaims(entitlement);

describe('license entitlement claims', () => {
  it('preserves the approved binding and named allocations without creating spendable credits', () => {
    expect(readLicenseClaims(claims)).toEqual(entitlement);
    expect(claims).toMatchObject({ development: 'cloud-only', reporting: 'cumulative.v1', iat: issuedAt / 1000 });
    expect(claims).not.toHaveProperty('credits');
    expect(claims).not.toHaveProperty('balance');
  });

  it('permits each standard plan and an explicitly bounded Enterprise offline package', () => {
    const plans: readonly LicensePlan[] = ['free', 'starter', 'team', 'custom', 'enterprise'];
    for (const plan of plans) expect(readLicenseClaims(licenseClaims({ ...entitlement, plan })).plan).toBe(plan);
    const offline: LicenseEntitlement = {
      ...entitlement,
      plan: 'enterprise',
      mode: 'enterprise-offline',
      expiresAt: issuedAt + 366 * day,
      refreshAfter: issuedAt + 100 * day,
      offlineDeadline: issuedAt + 366 * day,
      allocationIds: [],
      grantIds: [],
    };
    expect(readLicenseClaims(licenseClaims(offline))).toEqual(offline);
  });

  it.each(['version', 'aud', 'tariffVersion', 'policyVersion', 'development', 'reporting'])(
    'refuses unsupported %s even on an otherwise valid entitlement',
    (field) => {
      expect(() => readLicenseClaims({ ...claims, [field]: 'unsupported' })).toThrow('unsupported');
    },
  );

  it.each(['sub', 'customerId', 'licenseId', 'installationId', 'clusterId', 'jti'])(
    'requires a bounded canonical %s',
    (field) => {
      for (const value of [null, '', 'space in id', 'a'.repeat(257)])
        expect(() => readLicenseClaims({ ...claims, [field]: value })).toThrow('identifier');
    },
  );
});

describe('license types and fingerprint', () => {
  it.each([
    null,
    'not a url',
    'http://issuer.test',
    'https://user@issuer.test',
    'https://:secret@issuer.test',
    'https://issuer.test#fragment',
  ])('refuses an unsafe issuer %s', (iss) => {
    expect(() => readLicenseClaims({ ...claims, iss })).toThrow('HTTPS');
  });

  it.each(['generation', 'iat', 'nbf', 'exp', 'refreshAfter', 'offlineDeadline'])(
    'requires a safe non-negative integer %s',
    (field) => {
      for (const value of ['1', -1, 1.5, Number.NaN])
        expect(() => readLicenseClaims({ ...claims, [field]: value })).toThrow('safe non-negative');
    },
  );

  it('refuses timestamps outside the safe integer and Date ranges', () => {
    for (const exp of [Number.MAX_SAFE_INTEGER, 9_000_000_000_000])
      expect(() => readLicenseClaims({ ...claims, exp })).toThrow('supported date range');
    expect(() => licenseClaims({ ...entitlement, issuedAt: issuedAt + 1 })).toThrow('whole seconds');
  });

  it.each([undefined, 'not-a-sha256'])(
    'requires a SHA-256 installation key fingerprint %s',
    (installationKeyDigest) => {
      expect(() => readLicenseClaims({ ...claims, installationKeyDigest })).toThrow('SHA-256');
    },
  );

  it.each(['plan', 'ring', 'mode'])('refuses unsupported %s', (field) => {
    expect(() => readLicenseClaims({ ...claims, [field]: 'unsupported' })).toThrow('unsupported');
  });
});

describe('license capabilities and source references', () => {
  it.each(['allocationIds', 'grantIds'])('bounds and deduplicates %s', (field) => {
    for (const value of [null, Array.from({ length: 65 }, (_, index) => `item-${index}`)])
      expect(() => readLicenseClaims({ ...claims, [field]: value })).toThrow('bounded list');
    expect(() => readLicenseClaims({ ...claims, [field]: ['same', 'same'] })).toThrow('cannot repeat');
    expect(() => readLicenseClaims({ ...claims, [field]: [false] })).toThrow('identifier');
  });

  it('refuses unknown capabilities and cannot license customer-hosted model training', () => {
    for (const capabilities of [null, [], ['prediction-training'], ['arbitrary'], [null]])
      expect(() => readLicenseClaims({ ...claims, capabilities })).toThrow('supported protected work');
    expect(() => readLicenseClaims({ ...claims, capabilities: ['reasoning', 'reasoning'] })).toThrow('cannot repeat');
    expect(() => readLicenseClaims({ ...claims, development: 'local' })).toThrow('unsupported');
  });
});

describe('standard and enterprise license deadlines', () => {
  it('requires a positive validity of at most seven days for a standard license', () => {
    const changes = [
      { notBefore: issuedAt + 1000 },
      { expiresAt: issuedAt },
      { expiresAt: entitlement.expiresAt + 1000 },
    ];
    for (const change of changes)
      expect(() => licenseClaims({ ...entitlement, ...change })).toThrow('allowed lifetime');
  });

  it('bounds refresh and offline deadlines within the signed validity', () => {
    const changes = [
      { refreshAfter: issuedAt },
      { offlineDeadline: issuedAt },
      { offlineDeadline: entitlement.expiresAt + 1000 },
    ];
    for (const change of changes)
      expect(() => licenseClaims({ ...entitlement, ...change })).toThrow('must fit its validity');
    expect(() => licenseClaims({ ...entitlement, refreshAfter: issuedAt + day + 1000 })).toThrow('daily refresh');
  });

  it('permits the longer offline mode only for Enterprise and still bounds its validity', () => {
    expect(() => licenseClaims({ ...entitlement, mode: 'enterprise-offline' })).toThrow('requires an Enterprise plan');
    expect(() =>
      licenseClaims({
        ...entitlement,
        plan: 'enterprise',
        mode: 'enterprise-offline',
        expiresAt: issuedAt + 367 * day,
      }),
    ).toThrow('allowed lifetime');
  });
});
