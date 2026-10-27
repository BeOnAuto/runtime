import { describe, expect, it } from 'vitest';

import { allocationPayload, readAllocationClaims, type OfflineAllocation } from '../index.ts';

const allocation: OfflineAllocation = {
  issuer: 'https://licenses.auto.test',
  ring: 'local',
  accountId: 'account',
  installationId: 'installation',
  clusterId: 'cluster',
  installationKeyDigest: 'a'.repeat(64),
  id: 'allocation',
  epoch: 1,
  mode: 'standard',
  issuedAt: 5_001,
  expiresAt: 604_805_001,
  sources: [{ lotId: 'grant', source: 'free', issuedAt: 1_000, expiresAt: 100_000, units: 40_000_000n }],
};

function claims(changes: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    version: 'auto.offline-allocation.v1',
    audience: 'auto-runtime-offline',
    tariffVersion: '2026-10-26.v4',
    policyVersion: '2026-10-26.v4',
    funding: 'platform',
    ...allocation,
    sources: allocation.sources.map((source) => ({ ...source, units: String(source.units) })),
    ...changes,
  };
}

describe('offline allocation capacity', () => {
  it('preserves exact source amounts, expiry and millisecond issuance without creating a grant', () => {
    expect(readAllocationClaims(claims())).toEqual(allocation);
    const decoded: unknown = JSON.parse(allocationPayload(allocation));
    expect(readAllocationClaims(decoded)).toEqual(allocation);
    expect(allocationPayload(allocation)).toContain('"funding":"platform"');
  });

  it.each(['welcome', 'free', 'subscription', 'topup', 'enterprise', 'adjustment'])(
    'retains the %s source attribution',
    (source) => {
      expect(
        readAllocationClaims(claims({ sources: [{ ...allocation.sources[0], source, units: '1' }] })).sources[0]
          ?.source,
      ).toBe(source);
    },
  );

  it('permits an explicitly bounded Enterprise offline capacity', () => {
    const enterprise = { mode: 'enterprise-offline', expiresAt: allocation.issuedAt + 366 * 86_400_000 };
    expect(readAllocationClaims(claims(enterprise)).expiresAt).toBe(enterprise.expiresAt);
  });

  it('validates caller-supplied capacity before serialization', () => {
    expect(() => allocationPayload({ ...allocation, epoch: 0 })).toThrow('positive epoch');
  });
});

describe('offline allocation policy and shape', () => {
  it.each([null, 1, '', [], undefined])('refuses a non-object payload: %s', (value: unknown) => {
    expect(() => readAllocationClaims(value)).toThrow('object');
  });

  it.each([
    { version: 'other' },
    { audience: 'other' },
    { tariffVersion: 'old' },
    { policyVersion: 'old' },
    { funding: 'resource' },
    { issuer: 'http://local.test' },
    { ring: 'unknown' },
    { mode: 'unknown' },
    { accountId: '' },
    { installationId: '' },
    { clusterId: '' },
    { installationKeyDigest: 'bad' },
    { id: '' },
    { epoch: -1 },
    { epoch: 0 },
    { issuedAt: -1 },
    { expiresAt: 8_640_000_000_000_001 },
    { expiresAt: 5_001 },
    { expiresAt: allocation.expiresAt + 1 },
    { sources: null },
    { sources: [] },
    { sources: Array.from({ length: 65 }, () => ({})) },
  ])('refuses malformed or unsupported policy: %j', (changes: Readonly<Record<string, unknown>>) => {
    expect(() => readAllocationClaims(claims(changes))).toThrow(RangeError);
  });
});

describe('offline source validation', () => {
  const source = { lotId: 'grant', source: 'free', issuedAt: 1_000, expiresAt: 100_000, units: '1' };

  it.each([
    { units: 1 },
    { units: '0' },
    { units: '-1' },
    { units: '01' },
    { units: '0.1' },
    { units: '9007199254740992' },
    { lotId: '' },
    { source: 'invented' },
    { issuedAt: 5_002 },
    { issuedAt: Number.NaN },
    { expiresAt: 5_001 },
  ])('refuses unsafe source capacity: %j', (changes: Readonly<Record<string, unknown>>) => {
    expect(() => readAllocationClaims(claims({ sources: [{ ...source, ...changes }] }))).toThrow(RangeError);
  });

  it('requires real source records and distinct lot identities', () => {
    expect(() => readAllocationClaims(claims({ sources: [null] }))).toThrow('object');
    expect(() => readAllocationClaims(claims({ sources: [source, source] }))).toThrow('distinct source');
  });

  it('bounds the aggregate capacity even when each source fits', () => {
    expect(() =>
      readAllocationClaims(
        claims({
          sources: [
            { ...source, units: '9007199254740991' },
            { ...source, lotId: 'another' },
          ],
        }),
      ),
    ).toThrow('safe accounting');
  });
});
