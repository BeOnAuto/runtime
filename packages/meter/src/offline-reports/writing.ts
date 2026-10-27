import { statement, type ConnectionPorts } from '@on.auto/ledger';

import type { ReportSnapshot, StoredOfflineReport } from './records.ts';

export async function writePreparedReport(
  connection: ConnectionPorts,
  before: ReportSnapshot,
  prepared: StoredOfflineReport,
): Promise<boolean> {
  const attempt = crypto.randomUUID();
  const rows = await connection.transaction([
    statement`UPDATE meter_capacity_state SET revision = revision + 1, attempt_id = ${attempt}
      WHERE id = ${prepared.allocationId} AND revision = ${before.capacity.revision} AND revision < 9007199254740991
      AND state = ${before.capacity.state} AND state IN ('open', 'closing')
      AND report_sequence = ${before.sequence} AND report_sequence < 9007199254740991 AND checkpoint = ${before.capacity.checkpoint}
      AND NOT EXISTS (SELECT 1 FROM meter_pending_report p WHERE p.allocation_id = ${prepared.allocationId})`,
    statement`INSERT INTO meter_local_reports
      (allocation_id, sequence, snapshot_revision, charge_revision, checkpoint, payload_json, signed_report)
      SELECT ${prepared.allocationId}, ${prepared.sequence}, ${prepared.snapshotRevision}, ${prepared.chargeRevision},
        ${prepared.checkpoint}, ${prepared.payload}, ${prepared.signedReport}
      FROM meter_capacity_state WHERE id = ${prepared.allocationId} AND attempt_id = ${attempt}`,
    statement`INSERT INTO meter_pending_report (allocation_id, sequence)
      SELECT ${prepared.allocationId}, ${prepared.sequence} FROM meter_capacity_state
      WHERE id = ${prepared.allocationId} AND attempt_id = ${attempt} RETURNING sequence`,
  ]);
  return rows.length > 0;
}
