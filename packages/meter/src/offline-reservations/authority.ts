import { statement } from '@on.auto/ledger';
import { allocationPayload, type allocationVerifier } from '@on.auto/metering';
import { Schema } from 'effect';

import { readClock } from '../clock/clock-store.ts';
import type { CapacityAuthority, CapacityOptions, CapacitySnapshot } from '../offline-capacity/records.ts';
import { capacitySnapshot } from '../offline-capacity/snapshot.ts';
import type { OfflineReserveRequest } from './records.ts';

const tokenRow = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ token: Schema.String })]));

export interface ReservationOptions extends CapacityOptions {
  readonly verify: ReturnType<typeof allocationVerifier>;
}

export interface ReservationAuthority {
  readonly capacity: CapacitySnapshot;
  readonly authority: CapacityAuthority;
}

async function trustedAllocation(
  options: ReservationOptions,
  capacity: CapacitySnapshot,
  authority: CapacityAuthority,
) {
  const [row] = tokenRow(
    await options.connection.read(
      statement`SELECT token FROM meter_capacity_history WHERE id = ${capacity.allocation.id}`,
    ),
  );
  const verified = await options.verify(row.token, {
    license: authority.license.license,
    minimumEpoch: capacity.allocation.epoch,
    now: authority.now,
  });
  if (allocationPayload(verified) !== allocationPayload(capacity.allocation))
    throw new Error('offline_capacity_projection_invalid');
}

export async function reservationAuthority(
  options: ReservationOptions,
  request: OfflineReserveRequest,
): Promise<ReservationAuthority> {
  const capacity = await capacitySnapshot(options.connection);
  if (capacity === undefined) throw new Error('offline_allocation_required');
  if (capacity.state !== 'open') throw new Error('offline_allocation_unavailable');
  const license = await options.licenses.current(await options.clock.read());
  const clock = await readClock(options.connection);
  if (clock.onlineRequired) throw new Error('license_clock_untrusted');
  const authority = { license, now: clock.highWater, clockRevision: clock.revision };
  await trustedAllocation(options, capacity, authority);
  const { run } = request.context;
  if (run.accountId !== license.license.accountId || run.deploymentId !== license.license.installationId)
    throw new Error('offline_reservation_scope_mismatch');
  if (request.capabilities.some((capability) => !license.license.capabilities.includes(capability)))
    throw new Error('offline_capability_unlicensed');
  if (request.quote.expiresAt <= authority.now) throw new Error('offline_quote_expired');
  return { capacity, authority };
}
