import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { creditUnitsFromWire } from '@on.auto/metering';
import { Schema } from 'effect';

import type { OfflineCommand, OfflineReceipt } from './records.ts';

const storedNumber = Schema.Union([Schema.Number, Schema.FiniteFromString]);
const commandRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      payload_digest: Schema.String,
      allocation_id: Schema.String,
      reservation_id: Schema.String,
      revision: storedNumber,
      kind: Schema.Literals(['reserve', 'dispatch', 'release']),
      units: storedNumber,
    }),
  ),
);

export async function existingOfflineCommand(
  connection: Pick<ConnectionPorts, 'read'>,
  command: OfflineCommand,
): Promise<OfflineReceipt | undefined> {
  const [row] = commandRows(
    await connection.read(statement`SELECT payload_digest, allocation_id, reservation_id,
    revision, kind, units FROM meter_local_commands WHERE id = ${command.id}`),
  );
  if (row === undefined) return undefined;
  if (
    row.payload_digest !== command.payloadDigest ||
    row.reservation_id !== command.reservationId ||
    row.kind !== command.kind
  )
    throw new Error('offline_command_conflict');
  return {
    commandId: command.id,
    allocationId: row.allocation_id,
    reservationId: row.reservation_id,
    revision: row.revision,
    kind: row.kind,
    units: creditUnitsFromWire(String(row.units)),
  };
}
