import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { offlineCheckpoint, readUsageReportClaims, usageReportPayload, type OfflineUsageReport } from '../index.ts';

const charge = {
  playbookId: 'playbook',
  runId: 'run',
  evidenceDigest: 'b'.repeat(64),
  admittedAt: 5_000,
  committedAt: 6_000,
  parts: [{ lotId: 'grant', units: 1_000_000n }],
};
const report: OfflineUsageReport = {
  issuer: 'https://licenses.auto.test',
  ring: 'local',
  accountId: 'account',
  installationId: 'installation',
  clusterId: 'cluster',
  installationKeyDigest: 'a'.repeat(64),
  allocationId: 'allocation',
  epoch: 1,
  sequence: 1,
  previousCheckpoint: 'c'.repeat(64),
  reportedAt: 6_000,
  close: false,
  counters: [{ lotId: 'grant', committedUnits: 1_000_000n, reservedUnits: 2_000_000n }],
  charges: [charge],
};
const wireCharge = { ...charge, parts: [{ lotId: 'grant', units: '1000000' }] };

function claims(changes: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    version: 'auto.offline-report.v1',
    tariffVersion: '2026-10-26.v4',
    policyVersion: '2026-10-26.v4',
    ...report,
    counters: [{ lotId: 'grant', committedUnits: '1000000', reservedUnits: '2000000' }],
    charges: [wireCharge],
    ...changes,
  };
}

describe('cumulative offline report contracts', () => {
  it('round-trips exact quantities and run evidence without business data', () => {
    expect(readUsageReportClaims(claims())).toEqual(report);
    const decoded: unknown = JSON.parse(usageReportPayload(report));
    expect(readUsageReportClaims(decoded)).toEqual(report);
    expect(usageReportPayload(report)).not.toContain('prompt');
  });

  it('supports reservation-only updates and an explicit final close with no active reservations', () => {
    const closed = {
      ...report,
      close: true,
      charges: [],
      counters: [{ lotId: 'grant', committedUnits: 1_000_000n, reservedUnits: 0n }],
    };
    expect(readUsageReportClaims(claims({ charges: [] })).charges).toEqual([]);
    const decoded: unknown = JSON.parse(usageReportPayload(closed));
    expect(readUsageReportClaims(decoded)).toEqual(closed);
  });

  it('binds a checkpoint to every byte of the canonical evidence', async () => {
    const payload = usageReportPayload(report);
    expect(await offlineCheckpoint(payload)).toBe(createHash('sha256').update(payload).digest('hex'));
    expect(await offlineCheckpoint(`${payload} `)).not.toBe(await offlineCheckpoint(payload));
  });

  it('validates outgoing reports before signing', () => {
    expect(() => usageReportPayload({ ...report, close: true })).toThrow('reservations remain');
  });
});

describe('offline report shape and monotonic identities', () => {
  it.each([
    { version: 'old' },
    { tariffVersion: 'old' },
    { policyVersion: 'old' },
    { issuer: 'http://localhost' },
    { ring: 'other' },
    { accountId: '' },
    { installationId: '' },
    { clusterId: '' },
    { installationKeyDigest: '' },
    { allocationId: '' },
    { epoch: 0 },
    { epoch: -1 },
    { sequence: 0 },
    { sequence: 1.5 },
    { previousCheckpoint: '' },
    { reportedAt: -1 },
    { close: 'false' },
    { close: true },
    { counters: [] },
    { charges: null },
    { charges: Array.from({ length: 129 }, () => ({})) },
  ])('refuses invalid report fields: %j', (changes: Readonly<Record<string, unknown>>) => {
    expect(() => readUsageReportClaims(claims(changes))).toThrow(RangeError);
  });

  it('requires distinct source counters and logical runs', () => {
    const counter = { lotId: 'grant', committedUnits: '1', reservedUnits: '0' };
    expect(() => readUsageReportClaims(claims({ counters: [counter, counter] }))).toThrow('repeat a source');
    expect(() => readUsageReportClaims(claims({ charges: [wireCharge, wireCharge] }))).toThrow('repeat a logical run');
  });

  it('refuses nondecimal and unsafe quantities', () => {
    expect(() =>
      readUsageReportClaims(claims({ counters: [{ lotId: 'grant', committedUnits: 1, reservedUnits: '0' }] })),
    ).toThrow('decimal strings');
    expect(() =>
      readUsageReportClaims(claims({ counters: [{ lotId: 'grant', committedUnits: '01', reservedUnits: '0' }] })),
    ).toThrow('canonical');
  });
});

describe('offline run evidence', () => {
  it.each([
    { playbookId: '' },
    { runId: '' },
    { evidenceDigest: '' },
    { parts: [] },
    { parts: [{ lotId: 'grant', units: '0' }] },
    { parts: [{ lotId: 'grant', units: '999999' }] },
    { parts: [{ lotId: 'grant', units: '1000001' }] },
    {
      parts: [
        { lotId: 'grant', units: '500000' },
        { lotId: 'grant', units: '500000' },
      ],
    },
    { admittedAt: 6_001 },
    { committedAt: 6_001 },
  ])('refuses invalid fixed-fee evidence: %j', (changes: Readonly<Record<string, unknown>>) => {
    expect(() => readUsageReportClaims(claims({ charges: [{ ...wireCharge, ...changes }] }))).toThrow(RangeError);
  });

  it('permits one platform credit drawn from more than one source', () => {
    const parts = [
      { lotId: 'grant', units: '500000' },
      { lotId: 'topup', units: '500000' },
    ];
    expect(readUsageReportClaims(claims({ charges: [{ ...wireCharge, parts }] })).charges[0]?.parts).toEqual([
      { lotId: 'grant', units: 500_000n },
      { lotId: 'topup', units: 500_000n },
    ]);
  });
});
