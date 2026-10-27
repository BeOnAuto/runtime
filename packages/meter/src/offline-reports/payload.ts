import {
  MOST_REPORT_TOKEN_CHARACTERS,
  usageReportPayload,
  type OfflineUsageReport,
  type ReportCounter,
} from '@on.auto/metering';

import type { ReportCharge, ReportSnapshot } from './records.ts';

function reportCounters(snapshot: ReportSnapshot, charges: readonly ReportCharge[]): readonly ReportCounter[] {
  return snapshot.capacity.counters.map((counter) => {
    const previous =
      snapshot.previous?.report.counters.find((part) => part.lotId === counter.lotId)?.committedUnits ?? 0n;
    const delta = charges
      .flatMap((charge) => charge.parts)
      .filter((part) => part.lotId === counter.lotId)
      .reduce((sum, part) => sum + part.units, 0n);
    const committedUnits = previous + delta;
    if (
      committedUnits > counter.committedUnits ||
      (charges.length === snapshot.charges.length && committedUnits !== counter.committedUnits)
    )
      throw new Error('offline_report_counter_divergence');
    return { lotId: counter.lotId, committedUnits, reservedUnits: counter.reservedUnits };
  });
}

function reportFor(snapshot: ReportSnapshot, charges: readonly ReportCharge[]): OfflineUsageReport {
  const { allocation } = snapshot.capacity;
  const counters = reportCounters(snapshot, charges);
  return {
    issuer: allocation.issuer,
    ring: allocation.ring,
    accountId: allocation.accountId,
    installationId: allocation.installationId,
    clusterId: allocation.clusterId,
    installationKeyDigest: allocation.installationKeyDigest,
    allocationId: allocation.id,
    epoch: allocation.epoch,
    sequence: snapshot.sequence + 1,
    previousCheckpoint: snapshot.capacity.checkpoint,
    reportedAt: Math.max(
      allocation.issuedAt,
      snapshot.observedTime,
      snapshot.previous?.report.reportedAt ?? 0,
      ...charges.map((charge) => charge.committedAt),
    ),
    close:
      snapshot.capacity.state === 'closing' &&
      !snapshot.activeReservations &&
      charges.length === snapshot.charges.length,
    counters,
    charges,
  };
}

export function boundedReport(
  snapshot: ReportSnapshot,
): Readonly<{ report: OfflineUsageReport; payload: string; chargeRevision: number }> {
  const candidates = snapshot.charges.slice(0, 128);
  function bounded(count: number): ReturnType<typeof boundedReport> {
    const charges = candidates.slice(0, count);
    const report = reportFor(snapshot, charges);
    const payload = usageReportPayload(report);
    if (new TextEncoder().encode(payload).byteLength <= Math.floor(((MOST_REPORT_TOKEN_CHARACTERS - 512) * 3) / 4))
      return { report, payload, chargeRevision: charges.at(-1)?.revision ?? snapshot.reportedRevision };
    if (count <= 1) throw new Error('offline_report_exceeds_bound');
    return bounded(count - 1);
  }
  return bounded(candidates.length);
}
