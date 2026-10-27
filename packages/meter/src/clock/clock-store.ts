import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { Schema } from 'effect';

import type { ClockEstimate, ClockRow, ClockSample, ObservedTime, TrustedTime } from './records.ts';
import { clockMilliseconds } from './time-samples.ts';

const storedNumber = Schema.Union([Schema.Number, Schema.FiniteFromString]);
const readRow = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.Struct({
      revision: storedNumber,
      trust_epoch: storedNumber,
      trust_id: Schema.String,
      server_anchor: storedNumber,
      server_observation: storedNumber,
      wall_anchor: storedNumber,
      high_water: storedNumber,
      wall_seen: storedNumber,
      needs_online: Schema.Number,
    }),
  ]),
);
const readRefresh = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ trusted_at: storedNumber })));

export async function readClock(connection: ConnectionPorts): Promise<ClockRow> {
  const [row] = readRow(
    await connection.read(statement`SELECT revision, trust_epoch, trust_id, server_anchor, server_observation,
    wall_anchor, high_water, wall_seen, needs_online FROM meter_clock WHERE id = 1`),
  );
  return {
    revision: row.revision,
    epoch: row.trust_epoch,
    trustId: row.trust_id,
    serverAnchor: row.server_anchor,
    serverObservation: row.server_observation,
    wallAnchor: row.wall_anchor,
    highWater: row.high_water,
    wallSeen: row.wall_seen,
    onlineRequired: row.needs_online === 1,
  };
}

export async function advanceClock(
  connection: ConnectionPorts,
  before: ClockRow,
  next: ClockEstimate,
): Promise<boolean> {
  const rows = await connection.write(statement`UPDATE meter_clock SET revision = revision + 1,
    high_water = ${next.now}, wall_seen = ${Math.max(before.wallSeen, next.wall)}, needs_online = ${next.onlineRequired ? 1 : 0}
    WHERE id = 1 AND revision = ${before.revision} AND revision < 9007199254740991 RETURNING revision`);
  return rows.length > 0;
}

export async function alreadyTrusted(connection: ConnectionPorts, fresh: TrustedTime): Promise<boolean> {
  const [row] = readRefresh(
    await connection.read(statement`SELECT trusted_at FROM meter_clock_refreshes WHERE id = ${fresh.id}`),
  );
  if (row === undefined) return false;
  if (row.trusted_at !== fresh.serverTime) throw new Error('license_clock_proof_conflict');
  return true;
}

export async function trustClock(
  connection: ConnectionPorts,
  before: ClockRow,
  fresh: ObservedTime,
  sample: ClockSample,
): Promise<boolean> {
  if (sample.monotonic < fresh.monotonic) throw new Error('license_clock_invalid');
  const serverTime = clockMilliseconds(
    fresh.serverTime + (fresh.elapsedMilliseconds ?? 0) + sample.monotonic - fresh.monotonic,
  );
  const rows = await connection.transaction([
    statement`UPDATE meter_clock SET revision = revision + 1, trust_epoch = trust_epoch + 1,
      trust_id = ${fresh.id}, server_anchor = ${serverTime}, server_observation = ${fresh.serverTime}, wall_anchor = ${sample.wall},
      high_water = ${serverTime}, wall_seen = ${sample.wall}, needs_online = 0
      WHERE id = 1 AND revision = ${before.revision} AND revision < 9007199254740991
      AND trust_epoch < 9007199254740991`,
    statement`INSERT INTO meter_clock_refreshes (id, trusted_at)
      SELECT ${fresh.id}, ${fresh.serverTime} FROM meter_clock WHERE id = 1
      AND revision = ${before.revision + 1} AND trust_id = ${fresh.id}
      ON CONFLICT (id) DO NOTHING RETURNING id`,
  ]);
  return rows.length > 0;
}
