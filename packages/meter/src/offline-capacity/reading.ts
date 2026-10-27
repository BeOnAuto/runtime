import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { Schema } from 'effect';

import type { CapacityHead, CapacityReceipt } from './records.ts';

const storedNumber = Schema.Union([Schema.Number, Schema.FiniteFromString]);
export const capacityState = Schema.Literals(['open', 'closing', 'closed', 'quarantined']);
const headRow = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.Struct({
      revision: storedNumber,
      last_epoch: storedNumber,
      current_id: Schema.NullOr(Schema.String),
      state: Schema.NullOr(capacityState),
    }),
  ]),
);
const receiptRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      epoch: storedNumber,
      state: capacityState,
      token: Schema.String,
    }),
  ),
);

export async function readCapacityHead(connection: Pick<ConnectionPorts, 'read'>): Promise<CapacityHead> {
  const [row] = headRow(
    await connection.read(statement`SELECT h.revision, h.last_epoch, h.current_id, s.state
    FROM meter_capacity_head h LEFT JOIN meter_capacity_state s ON s.id = h.current_id WHERE h.id = 1`),
  );
  return { revision: row.revision, epoch: row.last_epoch, currentId: row.current_id, state: row.state };
}

export async function capacityReceipt(
  connection: ConnectionPorts,
  token: string,
  tokenDigest: string,
): Promise<CapacityReceipt | undefined> {
  const [row] = receiptRows(
    await connection.read(statement`SELECT h.id, h.epoch, h.token, s.state
    FROM meter_capacity_history h JOIN meter_capacity_state s ON s.id = h.id WHERE h.token_digest = ${tokenDigest}`),
  );
  if (row === undefined) return undefined;
  if (row.token !== token) throw new Error('offline_capacity_conflict');
  return { id: row.id, epoch: row.epoch, state: row.state };
}
