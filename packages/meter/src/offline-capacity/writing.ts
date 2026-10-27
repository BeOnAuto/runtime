import { statement, type ConnectionPorts, type Statement } from '@on.auto/ledger';
import { allocationPayload, creditUnitsForStorage, type AllocatedSource } from '@on.auto/metering';

import type { CapacityInstallation } from './records.ts';

function sourceWrites(
  source: AllocatedSource,
  installation: CapacityInstallation,
  attempt: string,
): readonly Statement[] {
  const id = installation.allocation.id;
  const units = creditUnitsForStorage(source.units);
  return [
    statement`INSERT INTO meter_capacity_sources (allocation_id, lot_id, units)
      SELECT ${id}, ${source.lotId}, ${units} FROM meter_capacity_head WHERE id = 1 AND attempt_id = ${attempt}`,
    statement`INSERT INTO meter_capacity_usage (allocation_id, lot_id, capacity_units, reserved_units, committed_units)
      SELECT ${id}, ${source.lotId}, ${units}, 0, 0 FROM meter_capacity_head WHERE id = 1 AND attempt_id = ${attempt}
      RETURNING lot_id`,
  ];
}

export async function writeCapacity(connection: ConnectionPorts, installation: CapacityInstallation): Promise<boolean> {
  const { before, authority, allocation, token, tokenDigest, checkpoint } = installation;
  const attempt = crypto.randomUUID();
  const rows = await connection.transaction([
    statement`UPDATE meter_capacity_head SET revision = revision + 1, last_epoch = ${allocation.epoch},
      current_id = ${allocation.id}, attempt_id = ${attempt}
      WHERE id = 1 AND revision = ${before.revision} AND revision < 9007199254740991 AND last_epoch < ${allocation.epoch}
      AND (current_id IS NULL OR EXISTS (SELECT 1 FROM meter_capacity_state s WHERE s.id = current_id AND s.state = 'closed'))
      AND EXISTS (SELECT 1 FROM meter_license_head l WHERE l.id = 1 AND l.state = 'active'
        AND l.revision = ${authority.license.revision} AND l.serial = ${authority.license.license.serial})
      AND EXISTS (SELECT 1 FROM meter_clock c WHERE c.id = 1 AND c.needs_online = 0
        AND c.revision = ${authority.clockRevision} AND c.high_water = ${authority.now})`,
    statement`INSERT INTO meter_capacity_history (id, epoch, token_digest, token, claims_json)
      SELECT ${allocation.id}, ${allocation.epoch}, ${tokenDigest}, ${token}, ${allocationPayload(allocation)}
      FROM meter_capacity_head WHERE id = 1 AND attempt_id = ${attempt}`,
    statement`INSERT INTO meter_capacity_state (id, revision, state, checkpoint)
      SELECT ${allocation.id}, 0, 'open', ${checkpoint} FROM meter_capacity_head WHERE id = 1 AND attempt_id = ${attempt}`,
    ...allocation.sources.flatMap((source) => sourceWrites(source, installation, attempt)),
  ]);
  return rows.length > 0;
}
