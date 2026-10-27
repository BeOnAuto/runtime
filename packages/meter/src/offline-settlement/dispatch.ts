import { offlineCheckpoint, runChargeId } from '@on.auto/metering';

import { readClock } from '../clock/clock-store.ts';
import type { CapacityOptions } from '../offline-capacity/records.ts';
import { performOfflineCommand } from '../offline-ledger/commands.ts';
import type { OfflineDispatchRequest } from '../offline-reservations/records.ts';
import { chargeWrites } from './charge-writes.ts';
import { dispatchParts } from './parts.ts';
import { assertDispatchRequest, dispatchScope, firstDispatchLicense, settlementReservation } from './validation.ts';
import { settlementMutation } from './writing.ts';

export async function commitOfflineDispatch(options: CapacityOptions, request: OfflineDispatchRequest) {
  assertDispatchRequest(request);
  const chargeId = await runChargeId(request.run, 'platform');
  const command = {
    id: `dispatch:${chargeId}`,
    reservationId: request.reservationId,
    kind: 'dispatch',
    payloadDigest: await offlineCheckpoint(
      JSON.stringify([
        'auto.local-dispatch.v1',
        chargeId,
        request.reservationId,
        request.capability,
        request.evidenceDigest,
      ]),
    ),
  } satisfies Parameters<typeof performOfflineCommand>[0]['command'];
  return performOfflineCommand({
    connection: options.connection,
    command,
    mutation: async () => {
      const reservation = await settlementReservation(options.connection, request.reservationId);
      await options.clock.read();
      const clock = await readClock(options.connection);
      if (clock.onlineRequired) throw new Error('license_clock_untrusted');
      dispatchScope(reservation, request, clock.highWater);
      const license = await firstDispatchLicense(options.licenses, reservation, request, {
        now: clock.highWater,
        onlineRequired: clock.onlineRequired,
      });
      const parts = dispatchParts(reservation);
      return settlementMutation({
        reservation,
        clock,
        parts,
        state: 'running',
        license,
        extraWrites: (attempt) =>
          chargeWrites({ chargeId, request, reservation, parts, now: clock.highWater }, attempt),
      });
    },
  });
}
