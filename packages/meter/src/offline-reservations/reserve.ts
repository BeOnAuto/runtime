import { performOfflineCommand } from '../offline-ledger/commands.ts';
import { reservationAuthority, type ReservationOptions } from './authority.ts';
import type { OfflineReserveRequest } from './records.ts';
import { reservationCommand } from './request.ts';
import { reserveMutation } from './writing.ts';

export async function reserveOffline(options: ReservationOptions, request: OfflineReserveRequest) {
  const command = await reservationCommand(request);
  return performOfflineCommand({
    connection: options.connection,
    command,
    mutation: async () => reserveMutation(await reservationAuthority(options, request), request, command),
  });
}
