import { statement, type ConnectionPorts } from '@on.auto/ledger';
import {
  allocationPayload,
  creditUnitsFromWire,
  readAllocationClaims,
  type OfflineAllocation,
} from '@on.auto/metering';
import { Schema } from 'effect';

import { capacityState, readCapacityHead } from './reading.ts';
import type { CapacitySnapshot } from './records.ts';

const storedNumber = Schema.Union([Schema.Number, Schema.FiniteFromString]);
const stateRow = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.Struct({
      revision: storedNumber,
      state: capacityState,
      checkpoint: Schema.String,
      claims_json: Schema.String,
    }),
  ]),
);
const usageRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      lot_id: Schema.String,
      capacity_units: storedNumber,
      reserved_units: storedNumber,
      committed_units: storedNumber,
    }),
  ),
);

async function counters(read: ConnectionPorts['read'], allocation: OfflineAllocation) {
  const rows = usageRows(
    await read(statement`SELECT lot_id, capacity_units, reserved_units, committed_units
    FROM meter_capacity_usage WHERE allocation_id = ${allocation.id} ORDER BY lot_id`),
  );
  if (rows.length !== allocation.sources.length) throw new Error('offline_capacity_projection_invalid');
  return rows.map((row) => {
    const source = allocation.sources.find((candidate) => candidate.lotId === row.lot_id);
    if (source?.units !== creditUnitsFromWire(String(row.capacity_units)))
      throw new Error('offline_capacity_projection_invalid');
    return {
      lotId: row.lot_id,
      reservedUnits: creditUnitsFromWire(String(row.reserved_units)),
      committedUnits: creditUnitsFromWire(String(row.committed_units)),
    };
  });
}

export function capacitySnapshot(connection: ConnectionPorts): Promise<CapacitySnapshot | undefined> {
  return connection.readConsistently(readCapacitySnapshot);
}

export async function readCapacitySnapshot(read: ConnectionPorts['read']): Promise<CapacitySnapshot | undefined> {
  const head = await readCapacityHead({ read });
  if (head.currentId === null) return undefined;
  const [row] = stateRow(
    await read(statement`SELECT s.revision, s.state, s.checkpoint, h.claims_json
      FROM meter_capacity_state s JOIN meter_capacity_history h ON h.id = s.id WHERE s.id = ${head.currentId}`),
  );
  const claims: unknown = JSON.parse(row.claims_json);
  const allocation = readAllocationClaims(claims);
  if (
    allocationPayload(allocation) !== row.claims_json ||
    allocation.id !== head.currentId ||
    allocation.epoch !== head.epoch
  )
    throw new Error('offline_capacity_projection_invalid');
  return {
    allocation,
    revision: row.revision,
    state: row.state,
    checkpoint: row.checkpoint,
    counters: await counters(read, allocation),
  };
}
