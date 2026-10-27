import { allocationVerifier } from '@on.auto/metering';

import { prepareMeter } from '../database/schema.ts';
import type { CapacityOptions } from '../offline-capacity/records.ts';
import { commitOfflineDispatch } from '../offline-settlement/dispatch.ts';
import { releaseOfflineReservation } from '../offline-settlement/release.ts';
import { readOfflineReservation } from './reading.ts';
import type { OfflineMeter } from './records.ts';
import { reserveOffline } from './reserve.ts';

export async function openOfflineMeter(options: CapacityOptions): Promise<OfflineMeter> {
  const captured = { ...options, verify: allocationVerifier(options.trust) };
  await prepareMeter(captured.connection);
  return {
    reserve: (request) => reserveOffline(captured, structuredClone(request)),
    commitDispatch: (request) => commitOfflineDispatch(captured, structuredClone(request)),
    release: (request) => releaseOfflineReservation(captured, structuredClone(request)),
    reservation: (id) => readOfflineReservation(captured.connection, id),
  };
}
