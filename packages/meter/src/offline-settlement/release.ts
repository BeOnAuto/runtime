import { offlineCheckpoint } from '@on.auto/metering';
import { Schema } from 'effect';

import { readClock } from '../clock/clock-store.ts';
import type { CapacityOptions } from '../offline-capacity/records.ts';
import { performOfflineCommand } from '../offline-ledger/commands.ts';
import type { OfflineReleaseRequest } from '../offline-reservations/records.ts';
import { releaseParts } from './parts.ts';
import { assertReservationAction, settlementReservation } from './validation.ts';
import { settlementMutation } from './writing.ts';

export async function releaseOfflineReservation(options: CapacityOptions, request: OfflineReleaseRequest) {
  assertReservationAction(request.reservationId, request.evidenceDigest);
  Schema.decodeUnknownSync(Schema.Literals(['completed', 'cancelled', 'not-dispatched']))(request.reason);
  const command = {
    id: `release:${request.reservationId}`,
    reservationId: request.reservationId,
    kind: 'release',
    payloadDigest: await offlineCheckpoint(
      JSON.stringify(['auto.local-release.v1', request.reservationId, request.reason, request.evidenceDigest]),
    ),
  } satisfies Parameters<typeof performOfflineCommand>[0]['command'];
  return performOfflineCommand({
    connection: options.connection,
    command,
    mutation: async () => {
      const reservation = await settlementReservation(options.connection, request.reservationId);
      if (
        (request.reason === 'not-dispatched' && reservation.state !== 'held') ||
        (request.reason === 'completed' && reservation.state !== 'running')
      )
        throw new Error('offline_release_evidence_mismatch');
      return settlementMutation({
        reservation,
        clock: await readClock(options.connection),
        parts: releaseParts(reservation),
        state: 'settled',
        license: undefined,
        extraWrites: () => [],
      });
    },
  });
}
