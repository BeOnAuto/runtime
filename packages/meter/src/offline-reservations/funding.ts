import { reserveFromLots, type LotReservation } from '@on.auto/metering';

import type { ReservationAuthority } from './authority.ts';
import type { OfflineReserveRequest } from './records.ts';

export function reservationFunding(
  verified: ReservationAuthority,
  request: OfflineReserveRequest,
): readonly LotReservation[] {
  const { capacity, authority } = verified;
  const lots = capacity.counters.map((counter) => {
    const source = capacity.allocation.sources.find((candidate) => candidate.lotId === counter.lotId);
    if (source === undefined) throw new Error('offline_capacity_projection_invalid');
    return {
      id: source.lotId,
      source: source.source,
      issuedAt: source.issuedAt,
      expiresAt: source.expiresAt,
      availableUnits: source.units - counter.reservedUnits - counter.committedUnits,
      categories: ['platform'],
    } satisfies Parameters<typeof reserveFromLots>[0][number];
  });
  return reserveFromLots(lots, {
    ...request.quote.maximum,
    now: authority.now,
    route: 'customer-hosted',
    cloudFreeRemainingUnits: 0n,
  });
}

export function firstDispatchDeadline(
  verified: ReservationAuthority,
  request: OfflineReserveRequest,
  parts: readonly LotReservation[],
): number {
  return Math.min(
    request.quote.expiresAt,
    verified.capacity.allocation.expiresAt,
    verified.authority.license.license.expiresAt,
    verified.authority.license.license.offlineDeadline,
    ...verified.capacity.allocation.sources
      .filter((source) => parts.some((part) => part.lotId === source.lotId))
      .map((source) => source.expiresAt),
  );
}
