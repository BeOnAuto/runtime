import { statement, type ConnectionPorts, type Statement } from '@on.auto/ledger';
import { creditUnitsForStorage } from '@on.auto/metering';

import type { OfflineCommand, OfflineMovement, OfflineMutation } from './records.ts';

function movementWrites(
  movement: OfflineMovement,
  command: OfflineCommand,
  mutation: OfflineMutation,
  attempt: string,
): readonly Statement[] {
  const reserved =
    movement.reservedDelta < 0n
      ? -creditUnitsForStorage(-movement.reservedDelta)
      : creditUnitsForStorage(movement.reservedDelta);
  const committed = creditUnitsForStorage(movement.committedDelta);
  return [
    statement`UPDATE meter_capacity_usage SET reserved_units = reserved_units + ${reserved},
      committed_units = committed_units + ${committed}
      WHERE allocation_id = ${mutation.allocationId} AND lot_id = ${movement.lotId}
      AND EXISTS (SELECT 1 FROM meter_capacity_state WHERE id = ${mutation.allocationId} AND attempt_id = ${attempt})`,
    statement`INSERT INTO meter_local_entries (command_id, allocation_id, lot_id, reserved_delta, committed_delta)
      SELECT ${command.id}, ${mutation.allocationId}, ${movement.lotId}, ${reserved}, ${committed}
      FROM meter_capacity_state WHERE id = ${mutation.allocationId} AND attempt_id = ${attempt}`,
  ];
}

export async function writeOfflineMutation(
  connection: ConnectionPorts,
  command: OfflineCommand,
  mutation: OfflineMutation,
): Promise<boolean> {
  if (mutation.revision === Number.MAX_SAFE_INTEGER) throw new Error('offline_accounting_exhausted');
  const attempt = crypto.randomUUID();
  const rows = await connection.transaction([
    mutation.claim(attempt),
    ...mutation.writes(attempt),
    statement`INSERT INTO meter_local_commands
      (id, payload_digest, allocation_id, reservation_id, revision, kind, units, occurred_at)
      SELECT ${command.id}, ${command.payloadDigest}, ${mutation.allocationId}, ${command.reservationId},
        ${mutation.revision + 1}, ${command.kind}, ${creditUnitsForStorage(mutation.units)}, ${mutation.now}
      FROM meter_capacity_state WHERE id = ${mutation.allocationId} AND attempt_id = ${attempt}`,
    ...mutation.movements.flatMap((movement) => movementWrites(movement, command, mutation, attempt)),
    statement`UPDATE meter_capacity_state SET attempt_id = ${attempt}
      WHERE id = ${mutation.allocationId} AND attempt_id = ${attempt} RETURNING revision`,
  ]);
  return rows.length > 0;
}
