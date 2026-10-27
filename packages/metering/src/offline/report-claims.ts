import {
  licenseDigest,
  licenseIdentifier,
  licenseInteger,
  licenseIssuer,
  licenseRing,
  licenseVersions,
} from '../licenses/claim-values.ts';
import { LICENSE_POLICY_VERSION } from '../licenses/entitlements.ts';
import { checkedCreditUnits, creditUnitsFromWire } from '../quantities/credits.ts';
import { platformCreditUnits, TARIFF_VERSION } from '../tariff/resources.ts';
import type { OfflineChargePart, OfflineRunCharge, OfflineUsageReport, ReportCounter } from './reports.ts';
import { offlineList, offlineRecord, offlineTime } from './values.ts';

const versions = {
  version: 'auto.offline-report.v1',
  tariffVersion: TARIFF_VERSION,
  policyVersion: LICENSE_POLICY_VERSION,
};

function quantity(value: unknown): bigint {
  if (typeof value !== 'string') throw new RangeError('Report quantities must use decimal strings');
  return creditUnitsFromWire(value);
}

function counter(value: unknown): ReportCounter {
  const row = offlineRecord(value);
  return {
    lotId: licenseIdentifier(row['lotId']),
    committedUnits: quantity(row['committedUnits']),
    reservedUnits: quantity(row['reservedUnits']),
  };
}

function chargePart(value: unknown): OfflineChargePart {
  const row = offlineRecord(value);
  const units = quantity(row['units']);
  if (units === 0n) throw new RangeError('A reported charge part must be positive');
  return { lotId: licenseIdentifier(row['lotId']), units };
}

function charge(value: unknown): OfflineRunCharge {
  const row = offlineRecord(value);
  const parts = offlineList(row['parts'], 64).map((part) => chargePart(part));
  const total = parts.reduce((sum, part) => checkedCreditUnits(sum + part.units), 0n);
  if (total !== platformCreditUnits(1n) || new Set(parts.map((part) => part.lotId)).size !== parts.length) {
    throw new RangeError('Each reported run charges one platform credit from distinct source lots');
  }
  return {
    playbookId: licenseIdentifier(row['playbookId']),
    runId: licenseIdentifier(row['runId']),
    evidenceDigest: licenseDigest(row['evidenceDigest']),
    admittedAt: offlineTime(row['admittedAt']),
    committedAt: offlineTime(row['committedAt']),
    parts,
  };
}

function charges(value: unknown): readonly OfflineRunCharge[] {
  if (!Array.isArray(value) || value.length > 128)
    throw new RangeError('A usage report contains at most 128 run charges');
  const entries = value.map((entry: unknown) => charge(entry));
  if (new Set(entries.map((entry) => JSON.stringify([entry.playbookId, entry.runId]))).size !== entries.length) {
    throw new RangeError('A usage report cannot repeat a logical run');
  }
  return entries;
}

function validReport(report: OfflineUsageReport): void {
  if (report.epoch === 0 || report.sequence === 0) {
    throw new RangeError('A usage report needs a positive epoch, sequence and explicit close decision');
  }
  if (new Set(report.counters.map((entry) => entry.lotId)).size !== report.counters.length) {
    throw new RangeError('A usage report cannot repeat a source counter');
  }
  if (report.close && report.counters.some((entry) => entry.reservedUnits !== 0n)) {
    throw new RangeError('An allocation cannot close while local reservations remain');
  }
  if (report.charges.some((entry) => entry.admittedAt > entry.committedAt || entry.committedAt > report.reportedAt)) {
    throw new RangeError('A reported run must be admitted before commitment and reporting');
  }
}

export function readUsageReportClaims(value: unknown): OfflineUsageReport {
  const row = offlineRecord(value);
  licenseVersions(row, versions);
  if (typeof row['close'] !== 'boolean') throw new RangeError('The usage report requires an explicit close decision');
  const report: OfflineUsageReport = {
    issuer: licenseIssuer(row['issuer']),
    ring: licenseRing(row['ring']),
    accountId: licenseIdentifier(row['accountId']),
    installationId: licenseIdentifier(row['installationId']),
    clusterId: licenseIdentifier(row['clusterId']),
    installationKeyDigest: licenseDigest(row['installationKeyDigest']),
    allocationId: licenseIdentifier(row['allocationId']),
    epoch: licenseInteger(row['epoch']),
    sequence: licenseInteger(row['sequence']),
    previousCheckpoint: licenseDigest(row['previousCheckpoint']),
    reportedAt: offlineTime(row['reportedAt']),
    close: row['close'],
    counters: offlineList(row['counters'], 64).map((entry) => counter(entry)),
    charges: charges(row['charges']),
  };
  validReport(report);
  return report;
}

export function usageReportPayload(report: OfflineUsageReport): string {
  const payload = {
    ...versions,
    issuer: report.issuer,
    ring: report.ring,
    accountId: report.accountId,
    installationId: report.installationId,
    clusterId: report.clusterId,
    installationKeyDigest: report.installationKeyDigest,
    allocationId: report.allocationId,
    epoch: report.epoch,
    sequence: report.sequence,
    previousCheckpoint: report.previousCheckpoint,
    reportedAt: report.reportedAt,
    close: report.close,
    counters: report.counters.map((entry) => ({
      lotId: entry.lotId,
      committedUnits: String(entry.committedUnits),
      reservedUnits: String(entry.reservedUnits),
    })),
    charges: report.charges.map((entry) => ({
      playbookId: entry.playbookId,
      runId: entry.runId,
      evidenceDigest: entry.evidenceDigest,
      admittedAt: entry.admittedAt,
      committedAt: entry.committedAt,
      parts: entry.parts.map((part) => ({ lotId: part.lotId, units: String(part.units) })),
    })),
  };
  readUsageReportClaims(payload);
  return JSON.stringify(payload);
}

export async function offlineCheckpoint(payload: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
