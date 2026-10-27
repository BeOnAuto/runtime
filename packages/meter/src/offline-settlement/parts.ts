import { platformCreditUnits } from '@on.auto/metering';

import type { OfflineReservation } from '../offline-reservations/records.ts';

export interface ReservationChange {
  readonly lotId: string;
  readonly committedUnits: bigint;
  readonly releasedUnits: bigint;
}

export function dispatchParts(reservation: OfflineReservation): readonly ReservationChange[] {
  let remaining = platformCreditUnits(1n);
  const parts: ReservationChange[] = [];
  for (const part of reservation.parts) {
    const units = remaining < part.reservedUnits ? remaining : part.reservedUnits;
    if (units > 0n) parts.push({ lotId: part.lotId, committedUnits: units, releasedUnits: 0n });
    remaining -= units;
  }
  if (remaining !== 0n) throw new Error('offline_reservation_exhausted');
  return parts;
}

export function releaseParts(reservation: OfflineReservation): readonly ReservationChange[] {
  return reservation.parts
    .filter((part) => part.reservedUnits > 0n)
    .map((part) => ({ lotId: part.lotId, committedUnits: 0n, releasedUnits: part.reservedUnits }));
}
