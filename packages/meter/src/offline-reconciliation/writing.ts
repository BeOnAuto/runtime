import { statement, type ConnectionPorts } from '@on.auto/ledger';

import type { CapacitySnapshot } from '../offline-capacity/records.ts';
import type { StoredOfflineReport } from '../offline-reports/records.ts';
import type { ReportAnswer } from './answers.ts';

export async function writeReportAcknowledgement(
  connection: ConnectionPorts,
  before: CapacitySnapshot,
  prepared: StoredOfflineReport,
  answer: ReportAnswer,
): Promise<boolean> {
  if (before.revision === Number.MAX_SAFE_INTEGER) throw new Error('offline_report_exhausted');
  const attempt = crypto.randomUUID();
  const quarantined = answer.state === 'quarantined';
  const state = answer.state === 'open' ? before.state : answer.state;
  const rows = await connection.transaction([
    statement`UPDATE meter_capacity_state SET revision = revision + 1, attempt_id = ${attempt}, state = ${state},
      checkpoint = ${quarantined ? before.checkpoint : prepared.checkpoint},
      report_sequence = ${quarantined ? prepared.sequence - 1 : prepared.sequence},
      reported_revision = CASE WHEN ${quarantined ? 1 : 0} = 1 THEN reported_revision ELSE ${prepared.chargeRevision} END
      WHERE id = ${prepared.allocationId} AND revision = ${before.revision} AND revision < 9007199254740991
      AND state = ${before.state} AND checkpoint = ${prepared.report.previousCheckpoint} AND report_sequence = ${prepared.sequence - 1}
      AND EXISTS (SELECT 1 FROM meter_pending_report p WHERE p.allocation_id = ${prepared.allocationId} AND p.sequence = ${prepared.sequence})`,
    statement`UPDATE meter_capacity_state SET state = 'quarantined', revision = revision + 1
      WHERE ${quarantined ? 1 : 0} = 1 AND id <> ${prepared.allocationId} AND state IN ('open', 'closing')
      AND EXISTS (SELECT 1 FROM meter_capacity_state c WHERE c.id = ${prepared.allocationId} AND c.attempt_id = ${attempt})`,
    statement`DELETE FROM meter_pending_report WHERE allocation_id = ${prepared.allocationId} AND sequence = ${prepared.sequence}
      AND EXISTS (SELECT 1 FROM meter_capacity_state c WHERE c.id = ${prepared.allocationId} AND c.attempt_id = ${attempt})`,
    statement`INSERT INTO meter_report_receipts (allocation_id, sequence, checkpoint, state, response_json, revision)
      SELECT ${prepared.allocationId}, ${prepared.sequence}, ${prepared.checkpoint}, ${answer.state}, ${answer.json}, revision
      FROM meter_capacity_state WHERE id = ${prepared.allocationId} AND attempt_id = ${attempt} RETURNING sequence`,
  ]);
  return rows.length > 0;
}
