import { statement, type Statement } from '@on.auto/ledger';
import { creditUnitsForStorage } from '@on.auto/metering';

import type { OfflineDispatchRequest, OfflineReservation } from '../offline-reservations/records.ts';
import type { ReservationChange } from './parts.ts';

interface ChargeWrite {
  readonly chargeId: string;
  readonly request: OfflineDispatchRequest;
  readonly reservation: OfflineReservation;
  readonly parts: readonly ReservationChange[];
  readonly now: number;
}

export function chargeWrites(write: ChargeWrite, attempt: string): readonly Statement[] {
  const { chargeId, request, reservation, parts, now } = write;
  return [
    statement`INSERT INTO meter_offline_charges
      (id, command_id, reservation_id, allocation_id, playbook_id, run_id, capability, evidence_digest, admitted_at, committed_at)
      SELECT ${chargeId}, ${`dispatch:${chargeId}`}, ${reservation.id}, ${reservation.allocationId},
        ${request.run.playbookId}, ${request.run.runId}, ${request.capability}, ${request.evidenceDigest}, ${reservation.admittedAt}, ${now}
      FROM meter_capacity_state WHERE id = ${reservation.allocationId} AND attempt_id = ${attempt}`,
    ...parts.map(
      (part) => statement`INSERT INTO meter_offline_charge_parts (charge_id, allocation_id, lot_id, units)
      SELECT ${chargeId}, ${reservation.allocationId}, ${part.lotId}, ${creditUnitsForStorage(part.committedUnits)}
      FROM meter_capacity_state WHERE id = ${reservation.allocationId} AND attempt_id = ${attempt}`,
    ),
  ];
}
