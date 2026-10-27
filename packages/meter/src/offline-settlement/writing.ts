import { statement, type Statement } from '@on.auto/ledger';
import { creditUnitsForStorage } from '@on.auto/metering';

import type { ClockRow } from '../clock/records.ts';
import type { CurrentLicense } from '../license-state/records.ts';
import type { OfflineMutation } from '../offline-ledger/records.ts';
import type { OfflineReservation } from '../offline-reservations/records.ts';
import type { ReservationChange } from './parts.ts';

interface SettlementWrite {
  readonly reservation: OfflineReservation;
  readonly clock: ClockRow;
  readonly state: 'running' | 'settled';
  readonly license: CurrentLicense | undefined;
  readonly parts: readonly ReservationChange[];
  readonly extraWrites: (attempt: string) => readonly Statement[];
}

function claimSettlement(write: SettlementWrite, attempt: string): Statement {
  const { reservation, clock, state, license } = write;
  return statement`UPDATE meter_capacity_state SET revision = revision + 1, attempt_id = ${attempt}
    WHERE id = ${reservation.allocationId} AND revision = ${reservation.allocationRevision} AND revision < 9007199254740991
    AND (state IN ('open', 'closing') OR (${state === 'settled' ? 1 : 0} = 1 AND state = 'quarantined'))
    AND EXISTS (SELECT 1 FROM meter_reservation_state r WHERE r.id = ${reservation.id} AND r.state = ${reservation.state})
    AND (${license === undefined ? 1 : 0} = 1 OR EXISTS (SELECT 1 FROM meter_license_head l WHERE l.id = 1 AND l.state = 'active'
      AND l.revision = ${license?.revision ?? -1} AND l.serial = ${license?.license.serial ?? ''}))
    AND (${state === 'settled' ? 1 : 0} = 1 OR EXISTS (SELECT 1 FROM meter_clock c WHERE c.id = 1 AND c.needs_online = 0
      AND c.revision = ${clock.revision} AND c.high_water = ${clock.highWater}))`;
}

function partWrites(write: SettlementWrite, part: ReservationChange, attempt: string): Statement {
  const committed = creditUnitsForStorage(part.committedUnits);
  const released = creditUnitsForStorage(part.releasedUnits);
  return statement`UPDATE meter_reservation_usage SET reserved_units = reserved_units - ${committed + released},
    committed_units = committed_units + ${committed}, released_units = released_units + ${released}
    WHERE reservation_id = ${write.reservation.id} AND lot_id = ${part.lotId}
    AND EXISTS (SELECT 1 FROM meter_capacity_state WHERE id = ${write.reservation.allocationId} AND attempt_id = ${attempt})`;
}

function settlementWrites(write: SettlementWrite, attempt: string): readonly Statement[] {
  return [
    ...write.parts.map((part) => partWrites(write, part, attempt)),
    statement`UPDATE meter_reservation_state SET state = ${write.state} WHERE id = ${write.reservation.id}
      AND EXISTS (SELECT 1 FROM meter_capacity_state WHERE id = ${write.reservation.allocationId} AND attempt_id = ${attempt})`,
    ...write.extraWrites(attempt),
  ];
}

export function settlementMutation(write: SettlementWrite): OfflineMutation {
  return {
    allocationId: write.reservation.allocationId,
    revision: write.reservation.allocationRevision,
    now: write.clock.highWater,
    units: write.parts.reduce((sum, part) => sum + part.committedUnits + part.releasedUnits, 0n),
    movements: write.parts.map((part) => ({
      lotId: part.lotId,
      reservedDelta: -part.committedUnits - part.releasedUnits,
      committedDelta: part.committedUnits,
    })),
    claim: (attempt) => claimSettlement(write, attempt),
    writes: (attempt) => settlementWrites(write, attempt),
  };
}
