import { statement, type Statement } from '@on.auto/ledger';
import { creditUnitsForStorage, type LotReservation } from '@on.auto/metering';

import type { OfflineCommand, OfflineMutation } from '../offline-ledger/records.ts';
import type { ReservationAuthority } from './authority.ts';
import { firstDispatchDeadline, reservationFunding } from './funding.ts';
import type { OfflineReserveRequest } from './records.ts';
import { quoteContextJson } from './request.ts';

interface ReservationWrite {
  readonly command: OfflineCommand;
  readonly request: OfflineReserveRequest;
  readonly verified: ReservationAuthority;
  readonly parts: readonly LotReservation[];
}

function claimReservation(verified: ReservationAuthority, attempt: string): Statement {
  const { capacity, authority } = verified;
  return statement`UPDATE meter_capacity_state SET revision = revision + 1, attempt_id = ${attempt}
    WHERE id = ${capacity.allocation.id} AND revision = ${capacity.revision} AND revision < 9007199254740991 AND state = 'open'
    AND EXISTS (SELECT 1 FROM meter_capacity_head h WHERE h.id = 1 AND h.current_id = ${capacity.allocation.id})
    AND EXISTS (SELECT 1 FROM meter_license_head l WHERE l.id = 1 AND l.state = 'active'
      AND l.revision = ${authority.license.revision} AND l.serial = ${authority.license.license.serial})
    AND EXISTS (SELECT 1 FROM meter_clock c WHERE c.id = 1 AND c.needs_online = 0
      AND c.revision = ${authority.clockRevision} AND c.high_water = ${authority.now})`;
}

function sourceWrites(
  part: LotReservation,
  position: number,
  write: ReservationWrite,
  attempt: string,
): readonly Statement[] {
  const allocation = write.verified.capacity.allocation.id;
  const units = creditUnitsForStorage(part.units);
  return [
    statement`INSERT INTO meter_reservation_sources (reservation_id, allocation_id, lot_id, position, units)
      SELECT ${write.command.reservationId}, ${allocation}, ${part.lotId}, ${position}, ${units}
      FROM meter_capacity_state WHERE id = ${allocation} AND attempt_id = ${attempt}`,
    statement`INSERT INTO meter_reservation_usage (reservation_id, lot_id, capacity_units, reserved_units, committed_units, released_units)
      SELECT ${write.command.reservationId}, ${part.lotId}, ${units}, ${units}, 0, 0
      FROM meter_capacity_state WHERE id = ${allocation} AND attempt_id = ${attempt}`,
  ];
}

function reservationWrites(write: ReservationWrite, attempt: string): readonly Statement[] {
  const { command, request, verified, parts } = write;
  const allocation = verified.capacity.allocation.id;
  return [
    statement`INSERT INTO meter_reservations
      (id, allocation_id, context_json, quote_id, capabilities_json, maximum_units, admitted_at, dispatch_before)
      SELECT ${command.reservationId}, ${allocation}, ${quoteContextJson(request.context)}, ${request.quote.id},
        ${JSON.stringify(request.capabilities.toSorted())}, ${creditUnitsForStorage(request.quote.maximum.platformUnits)},
        ${verified.authority.now}, ${firstDispatchDeadline(verified, request, parts)}
      FROM meter_capacity_state WHERE id = ${allocation} AND attempt_id = ${attempt}`,
    statement`INSERT INTO meter_reservation_state (id, state) SELECT ${command.reservationId}, 'held'
      FROM meter_capacity_state WHERE id = ${allocation} AND attempt_id = ${attempt}`,
    ...parts.flatMap((part, position) => sourceWrites(part, position, write, attempt)),
  ];
}

export function reserveMutation(
  verified: ReservationAuthority,
  request: OfflineReserveRequest,
  command: OfflineCommand,
): OfflineMutation {
  const parts = reservationFunding(verified, request);
  const write = { verified, request, command, parts };
  return {
    allocationId: verified.capacity.allocation.id,
    revision: verified.capacity.revision,
    now: verified.authority.now,
    units: request.quote.maximum.platformUnits,
    movements: parts.map((part) => ({ lotId: part.lotId, reservedDelta: part.units, committedDelta: 0n })),
    claim: (attempt) => claimReservation(verified, attempt),
    writes: (attempt) => reservationWrites(write, attempt),
  };
}
