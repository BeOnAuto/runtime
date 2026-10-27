import type { CurrentLicense } from '../license-state/records.ts';
import { assertChallengeAuthority } from '../licensing/challenge.ts';
import { LicenseServiceRefused } from '../licensing/transport.ts';
import { forgetPendingExchange } from './pending.ts';
import type { ClientServices, PendingExchange } from './records.ts';

async function trustedNow(clock: ClientServices['clock']): Promise<number> {
  const time = await clock.read();
  if (time.onlineRequired) throw new Error('license_clock_untrusted');
  return time.now;
}

export async function repairLicenseTime(services: ClientServices): Promise<void> {
  await services.clock.synchronize(await services.protocol.freshTime());
}

export function authorizationRefused(error: unknown): boolean {
  return error instanceof LicenseServiceRefused && (error.status === 401 || error.status === 403);
}

export async function finishLicenseExchange(
  services: ClientServices,
  pending: PendingExchange,
): Promise<CurrentLicense> {
  const { state, clock, protocol, connection } = services;
  assertChallengeAuthority(pending.challenge, services.trust, services.installation);
  try {
    const bundle = await protocol.complete(pending.challenge, () => trustedNow(clock));
    const result = await state.record({ ...pending, ...bundle, now: await trustedNow(clock) });
    await forgetPendingExchange(connection, pending.challenge.id);
    if (result.status === 'conflict') throw new Error('license_exchange_changed');
    return await state.current(await clock.read());
  } catch (error) {
    if (authorizationRefused(error)) await state.refuse(pending.expectedRevision);
    if (error instanceof LicenseServiceRefused && [400, 401, 403, 404, 409].includes(error.status))
      await forgetPendingExchange(connection, pending.challenge.id);
    throw error;
  }
}
