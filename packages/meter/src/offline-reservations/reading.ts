import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { creditUnitsFromWire, platformCreditUnits, runChargeId, runQuote } from '@on.auto/metering';
import { Schema } from 'effect';

import { capacityState } from '../offline-capacity/reading.ts';
import type { OfflineReservation } from './records.ts';
import { quoteContextJson, readCapabilities } from './request.ts';

const storedNumber = Schema.Union([Schema.Number, Schema.FiniteFromString]);
const contextValue = Schema.decodeUnknownSync(
  Schema.Struct({
    run: Schema.Struct({
      accountId: Schema.String,
      deploymentId: Schema.String,
      playbookId: Schema.String,
      runId: Schema.String,
    }),
    definitionVersion: Schema.String,
    inputDigest: Schema.String,
    limitsDigest: Schema.String,
    expiresAt: Schema.Number,
  }),
);
const reservationRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      allocation_id: Schema.String,
      context_json: Schema.String,
      quote_id: Schema.String,
      capabilities_json: Schema.String,
      maximum_units: storedNumber,
      admitted_at: storedNumber,
      dispatch_before: storedNumber,
      state: Schema.Literals(['held', 'running', 'settled']),
      allocation_state: capacityState,
      allocation_revision: storedNumber,
    }),
  ),
);
const partRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      lot_id: Schema.String,
      units: storedNumber,
      position: Schema.Number,
      capacity_units: storedNumber,
      reserved_units: storedNumber,
      committed_units: storedNumber,
      released_units: storedNumber,
    }),
  ),
);

async function reservationParts(read: ConnectionPorts['read'], id: string) {
  const rows = partRows(
    await read(statement`SELECT s.lot_id, s.units, s.position, u.capacity_units, u.reserved_units,
    u.committed_units, u.released_units FROM meter_reservation_sources s LEFT JOIN meter_reservation_usage u
    ON u.reservation_id = s.reservation_id AND u.lot_id = s.lot_id WHERE s.reservation_id = ${id} ORDER BY s.position`),
  );
  return rows.map((row, position) => {
    if (row.units !== row.capacity_units || row.position !== position)
      throw new Error('offline_reservation_projection_invalid');
    return {
      lotId: row.lot_id,
      units: creditUnitsFromWire(String(row.units)),
      reservedUnits: creditUnitsFromWire(String(row.reserved_units)),
      committedUnits: creditUnitsFromWire(String(row.committed_units)),
      releasedUnits: creditUnitsFromWire(String(row.released_units)),
    };
  });
}

function assertProjection(reservation: OfflineReservation): void {
  const total = reservation.parts.reduce((sum, part) => sum + part.units, 0n);
  if (
    total !== reservation.maximumUnits ||
    reservation.parts.some((part) => part.units !== part.reservedUnits + part.committedUnits + part.releasedUnits)
  )
    throw new Error('offline_reservation_projection_invalid');
  assertState(reservation);
}

function assertState(reservation: OfflineReservation): void {
  const committed = reservation.parts.some((part) => part.committedUnits > 0n);
  const released = reservation.parts.some((part) => part.releasedUnits > 0n);
  const reserved = reservation.parts.some((part) => part.reservedUnits > 0n);
  if (
    (reservation.state === 'held' && (committed || released)) ||
    (reservation.state === 'running' && (!committed || released)) ||
    (reservation.state === 'settled' && reserved)
  )
    throw new Error('offline_reservation_projection_invalid');
}

async function readReservation(read: ConnectionPorts['read'], id: string): Promise<OfflineReservation | undefined> {
  const [row] = reservationRows(
    await read(statement`SELECT r.*, s.state, c.state AS allocation_state,
    c.revision AS allocation_revision FROM meter_reservations r JOIN meter_reservation_state s ON s.id = r.id
    JOIN meter_capacity_state c ON c.id = r.allocation_id WHERE r.id = ${id}`),
  );
  if (row === undefined) return undefined;
  const context = contextValue(JSON.parse(row.context_json));
  const capabilities = readCapabilities(JSON.parse(row.capabilities_json));
  const maximumUnits = creditUnitsFromWire(String(row.maximum_units));
  const quote = await runQuote(
    context,
    {
      type: 'repeat',
      iterations: maximumUnits / platformCreditUnits(1n),
      body: { type: 'run', resources: [], developmentUnits: 0n },
    },
    0,
  );
  if (
    quote.id !== row.quote_id ||
    quote.maximum.platformUnits !== maximumUnits ||
    `reservation:${await runChargeId(context.run, 'platform')}` !== id ||
    quoteContextJson(context) !== row.context_json ||
    capabilities.length === 0 ||
    new Set(capabilities).size !== capabilities.length
  )
    throw new Error('offline_reservation_projection_invalid');
  const reservation: OfflineReservation = {
    id,
    allocationId: row.allocation_id,
    allocationRevision: row.allocation_revision,
    allocationState: row.allocation_state,
    context,
    quoteId: row.quote_id,
    capabilities,
    maximumUnits,
    admittedAt: row.admitted_at,
    dispatchBefore: row.dispatch_before,
    state: row.state,
    parts: await reservationParts(read, id),
  };
  assertProjection(reservation);
  return reservation;
}

export function readOfflineReservation(
  connection: ConnectionPorts,
  id: string,
): Promise<OfflineReservation | undefined> {
  return connection.readConsistently((read) => readReservation(read, id));
}
