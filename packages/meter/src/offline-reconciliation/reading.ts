import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { allocationPayload, readAllocationClaims } from '@on.auto/metering';
import { Schema } from 'effect';

import type { OfflineReportDelivery, StoredOfflineReport } from '../offline-reports/records.ts';
import type { ReportAnswer } from './answers.ts';

const allocationRow = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ claims_json: Schema.String })]));
const receiptRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      checkpoint: Schema.String,
      state: Schema.Literals(['open', 'closed', 'quarantined']),
      response_json: Schema.String,
    }),
  ),
);

export async function allocationForReport(connection: ConnectionPorts, id: string) {
  const [row] = allocationRow(
    await connection.read(statement`SELECT claims_json FROM meter_capacity_history WHERE id = ${id}`),
  );
  const allocation = readAllocationClaims(JSON.parse(row.claims_json));
  if (allocation.id !== id || allocationPayload(allocation) !== row.claims_json)
    throw new Error('offline_capacity_projection_invalid');
  return allocation;
}

export async function existingReportReceipt(
  connection: ConnectionPorts,
  prepared: StoredOfflineReport,
  answer: ReportAnswer,
): Promise<OfflineReportDelivery | undefined> {
  const [row] = receiptRows(
    await connection.read(statement`SELECT checkpoint, state, response_json FROM meter_report_receipts
    WHERE allocation_id = ${prepared.allocationId} AND sequence = ${prepared.sequence}`),
  );
  if (row === undefined) return undefined;
  if (row.checkpoint !== prepared.checkpoint || row.state !== answer.state || row.response_json !== answer.json)
    throw new Error('offline_report_acknowledgement_conflict');
  return {
    allocationId: prepared.allocationId,
    sequence: prepared.sequence,
    checkpoint: prepared.checkpoint,
    state: answer.state,
    status: 'existing',
  };
}
