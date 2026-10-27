import { statement, type ConnectionPorts } from '@on.auto/ledger';
import {
  readUsageReportClaims,
  usageReportPayload,
  verifyUsageReport,
  type OfflineAllocation,
} from '@on.auto/metering';
import { Schema } from 'effect';

import type { InstallationIdentity } from '../installation/records.ts';
import type { StoredOfflineReport } from './records.ts';

const storedNumber = Schema.Union([Schema.Number, Schema.FiniteFromString]);
const reportRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      sequence: storedNumber,
      snapshot_revision: storedNumber,
      charge_revision: storedNumber,
      checkpoint: Schema.String,
      payload_json: Schema.String,
      signed_report: Schema.String,
    }),
  ),
);
const pendingRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ sequence: storedNumber })));

export async function readStoredReport(
  read: ConnectionPorts['read'],
  allocation: OfflineAllocation,
  installation: InstallationIdentity,
  sequence: number,
): Promise<StoredOfflineReport> {
  const [row] = reportRows(
    await read(statement`SELECT sequence, snapshot_revision, charge_revision, checkpoint,
    payload_json, signed_report FROM meter_local_reports WHERE allocation_id = ${allocation.id} AND sequence = ${sequence}`),
  );
  if (row === undefined) throw new Error('offline_report_history_unavailable');
  const report = readUsageReportClaims(JSON.parse(row.payload_json));
  const verified = await verifyUsageReport(row.signed_report, allocation, installation.publicKey, report.reportedAt);
  if (
    report.sequence !== sequence ||
    usageReportPayload(report) !== row.payload_json ||
    usageReportPayload(verified.report) !== row.payload_json ||
    verified.checkpoint !== row.checkpoint ||
    row.charge_revision > row.snapshot_revision
  )
    throw new Error('offline_report_projection_invalid');
  return {
    allocationId: allocation.id,
    sequence,
    report,
    checkpoint: row.checkpoint,
    signedReport: row.signed_report,
    payload: row.payload_json,
    snapshotRevision: row.snapshot_revision,
    chargeRevision: row.charge_revision,
  };
}

export async function readPendingReport(
  read: ConnectionPorts['read'],
  allocation: OfflineAllocation,
  installation: InstallationIdentity,
): Promise<StoredOfflineReport | undefined> {
  const [row] = pendingRows(
    await read(statement`SELECT sequence FROM meter_pending_report WHERE allocation_id = ${allocation.id}`),
  );
  return row === undefined ? undefined : readStoredReport(read, allocation, installation, row.sequence);
}
