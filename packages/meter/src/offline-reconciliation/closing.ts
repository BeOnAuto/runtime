import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { Schema } from 'effect';

import { capacityState } from '../offline-capacity/reading.ts';
import type { CapacityReceipt } from '../offline-capacity/records.ts';
import { capacitySnapshot } from '../offline-capacity/snapshot.ts';

const closeRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      epoch: Schema.Union([Schema.Number, Schema.FiniteFromString]),
      state: capacityState,
    }),
  ),
);

async function closeReceipt(connection: ConnectionPorts, id: string): Promise<CapacityReceipt | undefined> {
  const [row] = closeRows(
    await connection.read(statement`SELECT h.id, h.epoch, s.state FROM meter_close_requests r
    JOIN meter_capacity_history h ON h.id = r.allocation_id JOIN meter_capacity_state s ON s.id = h.id
    WHERE r.allocation_id = ${id}`),
  );
  return row;
}

export async function requestOfflineClose(
  connection: ConnectionPorts,
  id: string,
  attempts = 128,
): Promise<CapacityReceipt> {
  if (attempts === 0) throw new Error('offline_close_contended');
  const previous = await closeReceipt(connection, id);
  if (previous !== undefined) return previous;
  try {
    const closed = await closeAttempt(connection, id);
    if (closed !== undefined) return closed;
  } catch (error) {
    const recovered = await closeReceipt(connection, id);
    if (recovered !== undefined) return recovered;
    throw error;
  }
  return requestOfflineClose(connection, id, attempts - 1);
}

async function closeAttempt(connection: ConnectionPorts, id: string): Promise<CapacityReceipt | undefined> {
  const before = await capacitySnapshot(connection);
  if (before === undefined || before.allocation.id !== id) throw new Error('offline_allocation_not_current');
  if (before.state !== 'open') throw new Error('offline_allocation_unavailable');
  if (before.revision === Number.MAX_SAFE_INTEGER) throw new Error('offline_close_exhausted');
  const attempt = crypto.randomUUID();
  const rows = await connection.transaction([
    statement`UPDATE meter_capacity_state SET state = 'closing', revision = revision + 1, attempt_id = ${attempt}
        WHERE id = ${id} AND revision = ${before.revision} AND revision < 9007199254740991 AND state = 'open'
        AND EXISTS (SELECT 1 FROM meter_capacity_head h WHERE h.id = 1 AND h.current_id = ${id})`,
    statement`INSERT INTO meter_close_requests (allocation_id, revision, checkpoint)
        SELECT ${id}, revision, checkpoint FROM meter_capacity_state WHERE id = ${id} AND attempt_id = ${attempt}
        RETURNING allocation_id`,
  ]);
  if (rows.length > 0) return { id, epoch: before.allocation.epoch, state: 'closing' };
  return undefined;
}
