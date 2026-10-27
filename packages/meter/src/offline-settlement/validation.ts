import type { ConnectionPorts } from '@on.auto/ledger';
import { assertOfflineRunIdentity } from '@on.auto/metering';
import { Schema } from 'effect';

import type { LicenseTime } from '../clock/records.ts';
import type { CurrentLicense, LicenseState } from '../license-state/records.ts';
import { readOfflineReservation } from '../offline-reservations/reading.ts';
import type { OfflineDispatchRequest, OfflineReservation } from '../offline-reservations/records.ts';
import { capabilityValues } from '../offline-reservations/request.ts';

export function assertDispatchRequest(request: OfflineDispatchRequest): void {
  assertOfflineRunIdentity(request.run);
  assertReservationAction(request.reservationId, request.evidenceDigest);
  Schema.decodeUnknownSync(capabilityValues)(request.capability);
}

export async function firstDispatchLicense(
  licenses: LicenseState,
  reservation: OfflineReservation,
  request: OfflineDispatchRequest,
  time: LicenseTime,
): Promise<CurrentLicense | undefined> {
  if (reservation.state !== 'held') return undefined;
  const root = reservation.context.run;
  if (root.playbookId !== request.run.playbookId || root.runId !== request.run.runId)
    throw new Error('offline_root_dispatch_required');
  const current = await licenses.current(time);
  const license = current.license;
  if (
    !license.capabilities.includes(request.capability) ||
    !license.allocationIds.includes(reservation.allocationId) ||
    reservation.parts.some((part) => !license.grantIds.includes(part.lotId))
  )
    throw new Error('offline_reservation_no_longer_licensed');
  return current;
}

export function dispatchScope(reservation: OfflineReservation, request: OfflineDispatchRequest, now: number): void {
  const { run } = reservation.context;
  if (run.accountId !== request.run.accountId || run.deploymentId !== request.run.deploymentId)
    throw new Error('offline_reservation_scope_mismatch');
  if (!reservation.capabilities.includes(request.capability)) throw new Error('offline_capability_unreserved');
  if (reservation.allocationState === 'quarantined') throw new Error('offline_allocation_unavailable');
  if (now < reservation.admittedAt) throw new Error('offline_clock_precedes_reservation');
  if (reservation.state === 'held' && now >= reservation.dispatchBefore)
    throw new Error('offline_dispatch_deadline_expired');
}

export function assertReservationAction(id: string, evidenceDigest: string): void {
  if (!/^reservation:charge_[a-f0-9]{64}$/u.test(id)) throw new Error('offline_reservation_id_invalid');
  if (!/^[a-f0-9]{64}$/u.test(evidenceDigest)) throw new Error('offline_evidence_invalid');
}

export async function settlementReservation(connection: ConnectionPorts, id: string) {
  const reservation = await readOfflineReservation(connection, id);
  if (reservation === undefined) throw new Error('offline_reservation_missing');
  if (reservation.state === 'settled') throw new Error('offline_reservation_settled');
  if (reservation.allocationState === 'closed') throw new Error('offline_allocation_unavailable');
  return reservation;
}
