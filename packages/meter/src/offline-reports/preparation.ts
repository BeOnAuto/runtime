import {
  MOST_REPORT_TOKEN_CHARACTERS,
  offlineCheckpoint,
  usageReportPayload,
  verifyUsageReport,
} from '@on.auto/metering';

import { readCapacitySnapshot } from '../offline-capacity/snapshot.ts';
import { boundedReport } from './payload.ts';
import { readPendingReport } from './reading.ts';
import type { OfflineReporterOptions, ReportSnapshot, StoredOfflineReport } from './records.ts';
import { reportSnapshot } from './snapshot.ts';
import { writePreparedReport } from './writing.ts';

export function pendingOfflineReport(options: OfflineReporterOptions): Promise<StoredOfflineReport | undefined> {
  return options.connection.readConsistently(async (read) => {
    const capacity = await readCapacitySnapshot(read);
    return capacity === undefined ? undefined : readPendingReport(read, capacity.allocation, options.installation);
  });
}

async function signedReport(options: OfflineReporterOptions, snapshot: ReportSnapshot): Promise<StoredOfflineReport> {
  const bounded = boundedReport(snapshot);
  const signed = await options.installation.signReport(bounded.report);
  if (signed.length > MOST_REPORT_TOKEN_CHARACTERS) throw new Error('offline_report_exceeds_bound');
  const verified = await verifyUsageReport(
    signed,
    snapshot.capacity.allocation,
    options.installation.publicKey,
    bounded.report.reportedAt,
  );
  if (usageReportPayload(verified.report) !== bounded.payload) throw new Error('offline_report_signature_mismatch');
  return {
    allocationId: snapshot.capacity.allocation.id,
    sequence: bounded.report.sequence,
    checkpoint: await offlineCheckpoint(bounded.payload),
    signedReport: signed,
    report: verified.report,
    snapshotRevision: snapshot.capacity.revision,
    chargeRevision: bounded.chargeRevision,
    payload: bounded.payload,
  };
}

export async function prepareOfflineReport(
  options: OfflineReporterOptions,
  attempts = 128,
): Promise<StoredOfflineReport | undefined> {
  if (attempts === 0) throw new Error('offline_report_contended');
  const snapshot = await reportSnapshot(options);
  if (snapshot === undefined || 'signedReport' in snapshot) return snapshot;
  try {
    const prepared = await signedReport(options, snapshot);
    if (await writePreparedReport(options.connection, snapshot, prepared)) return prepared;
  } catch (error) {
    const recovered = await pendingOfflineReport(options);
    if (recovered !== undefined) return recovered;
    throw error;
  }
  return prepareOfflineReport(options, attempts - 1);
}
