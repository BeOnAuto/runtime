import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { creditUnitsFromWire } from '@on.auto/metering';
import { Schema } from 'effect';

import type { ReportCharge } from './records.ts';

const storedNumber = Schema.Union([Schema.Number, Schema.FiniteFromString]);
const chargeRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      revision: storedNumber,
      playbook_id: Schema.String,
      run_id: Schema.String,
      evidence_digest: Schema.String,
      admitted_at: storedNumber,
      committed_at: storedNumber,
    }),
  ),
);
const partRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ lot_id: Schema.String, units: storedNumber })));

export async function unreportedCharges(
  read: ConnectionPorts['read'],
  allocationId: string,
  revision: number,
): Promise<readonly ReportCharge[]> {
  const rows = chargeRows(
    await read(statement`SELECT c.id, c.playbook_id, c.run_id, c.evidence_digest, c.admitted_at,
    c.committed_at, m.revision FROM meter_offline_charges c JOIN meter_local_commands m ON m.id = c.command_id
    WHERE c.allocation_id = ${allocationId} AND m.allocation_id = ${allocationId} AND m.kind = 'dispatch'
    AND m.revision > ${revision} ORDER BY m.revision LIMIT 129`),
  );
  return Promise.all(
    rows.map(async (row) => ({
      revision: row.revision,
      playbookId: row.playbook_id,
      runId: row.run_id,
      evidenceDigest: row.evidence_digest,
      admittedAt: row.admitted_at,
      committedAt: row.committed_at,
      parts: partRows(
        await read(statement`SELECT lot_id, units FROM meter_offline_charge_parts
      WHERE charge_id = ${row.id} AND allocation_id = ${allocationId} ORDER BY lot_id`),
      ).map((part) => ({ lotId: part.lot_id, units: creditUnitsFromWire(String(part.units)) })),
    })),
  );
}
