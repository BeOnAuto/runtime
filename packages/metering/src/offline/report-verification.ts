import { compactVerify, importJWK } from 'jose';

import { installationKeyFingerprint, readInstallationPublicKey } from '../licenses/installation-keys.ts';
import { checkedCreditUnits } from '../quantities/credits.ts';
import type { OfflineAllocation } from './allocations.ts';
import { offlineCheckpoint, readUsageReportClaims, usageReportPayload } from './report-claims.ts';
import { MOST_REPORT_TOKEN_CHARACTERS, OFFLINE_REPORT_TYPE, type OfflineUsageReport } from './reports.ts';
import { offlineTime } from './values.ts';

function assertReportBinding(report: OfflineUsageReport, allocation: OfflineAllocation): void {
  if (
    report.issuer !== allocation.issuer ||
    report.ring !== allocation.ring ||
    report.accountId !== allocation.accountId ||
    report.installationId !== allocation.installationId ||
    report.clusterId !== allocation.clusterId ||
    report.installationKeyDigest !== allocation.installationKeyDigest ||
    report.allocationId !== allocation.id ||
    report.epoch !== allocation.epoch
  )
    throw new RangeError('The usage report belongs to another allocation, epoch or installation');
}

function assertCounters(report: OfflineUsageReport, allocation: OfflineAllocation): void {
  if (report.counters.length !== allocation.sources.length)
    throw new RangeError('The report must include every allocated source counter');
  for (const entry of report.counters) {
    const source = allocation.sources.find((item) => item.lotId === entry.lotId);
    if (source === undefined || checkedCreditUnits(entry.committedUnits + entry.reservedUnits) > source.units) {
      throw new RangeError('The reported counters exceed their source capacity');
    }
  }
}

function assertCharges(report: OfflineUsageReport, allocation: OfflineAllocation): void {
  for (const charge of report.charges) {
    if (charge.admittedAt < allocation.issuedAt || charge.admittedAt >= allocation.expiresAt) {
      throw new RangeError('The reported run was admitted outside its allocation validity');
    }
    for (const part of charge.parts) {
      const source = allocation.sources.find((item) => item.lotId === part.lotId);
      if (source === undefined || charge.admittedAt >= source.expiresAt) {
        throw new RangeError('The reported run used an unknown or expired source');
      }
    }
  }
}

export async function verifyUsageReport(
  token: string,
  allocation: OfflineAllocation,
  publicKey: unknown,
  now: number,
): Promise<Readonly<{ report: OfflineUsageReport; checkpoint: string }>> {
  offlineTime(now);
  if (token.length > MOST_REPORT_TOKEN_CHARACTERS) throw new RangeError('The usage report exceeds its size bound');
  const key = readInstallationPublicKey(publicKey);
  const fingerprint = await installationKeyFingerprint(key);
  if (fingerprint !== allocation.installationKeyDigest)
    throw new RangeError('The allocation belongs to another public key');
  const { protectedHeader, payload } = await compactVerify(token, await importJWK({ ...key }, 'EdDSA'), {
    algorithms: ['EdDSA'],
  });
  if (protectedHeader.typ !== OFFLINE_REPORT_TYPE || protectedHeader.kid !== fingerprint) {
    throw new RangeError('The usage report must name its dedicated type and installed signing key');
  }
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payload);
  const claims: unknown = JSON.parse(text);
  const report = readUsageReportClaims(claims);
  if (text !== usageReportPayload(report)) throw new RangeError('The usage report payload must be canonical');
  if (report.reportedAt < allocation.issuedAt || report.reportedAt > now)
    throw new RangeError('The report is outside its trusted time');
  assertReportBinding(report, allocation);
  assertCounters(report, allocation);
  assertCharges(report, allocation);
  return { report, checkpoint: await offlineCheckpoint(text) };
}
