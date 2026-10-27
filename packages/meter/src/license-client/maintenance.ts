import { scheduledMaintenance } from '../maintenance/poll.ts';
import { refreshLicense } from './exchanges.ts';
import { readPendingExchange } from './pending.ts';
import type { ClientServices, LicensePollResult } from './records.ts';

async function refreshNeeded(services: ClientServices, jitter: number): Promise<boolean> {
  if ((await readPendingExchange(services.connection)) !== undefined) return true;
  const head = await services.state.head();
  if (head.state === 'unlicensed') return false;
  const time = await services.clock.read();
  try {
    const { license } = await services.state.current(time);
    const advance = Math.min(jitter, Math.floor((license.refreshAfter - license.issuedAt) / 10));
    return time.now >= license.refreshAfter - advance;
  } catch {
    return true;
  }
}

export function licenseMaintenance(
  services: ClientServices,
  monotonicTime: () => number,
): () => Promise<LicensePollResult> {
  const jitter = Number.parseInt(services.installation.installationKeyDigest.slice(0, 8), 16) % 900_000;
  return scheduledMaintenance<'refreshed'>(async () => {
    const needed = await refreshNeeded(services, jitter);
    if (needed) await refreshLicense(services);
    return { status: needed ? 'refreshed' : 'idle', retryInMilliseconds: 60_000 };
  }, monotonicTime);
}
