import { clockMilliseconds } from '../clock/time-samples.ts';
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
  const state: { failures: number; next: number; running: Promise<LicensePollResult> | undefined; last: number } = {
    failures: 0,
    next: 0,
    running: undefined,
    last: 0,
  };
  const attempt = async (): Promise<LicensePollResult> => {
    try {
      const needed = await refreshNeeded(services, jitter);
      if (needed) await refreshLicense(services);
      state.failures = 0;
      return { status: needed ? 'refreshed' : 'idle', retryInMilliseconds: 60_000 };
    } catch {
      state.failures = Math.min(state.failures + 1, 8);
      return { status: 'failed', retryInMilliseconds: Math.min(3_600_000, 30_000 * 2 ** (state.failures - 1)) };
    }
  };
  return async () => {
    if (state.running !== undefined) return state.running;
    const now = clockMilliseconds(Math.floor(monotonicTime()));
    if (now < state.last) state.next = 0;
    state.last = now;
    if (now < state.next) return { status: 'idle', retryInMilliseconds: state.next - now };
    state.running = attempt();
    try {
      const result = await state.running;
      state.next = clockMilliseconds(Math.floor(monotonicTime()) + result.retryInMilliseconds);
      return result;
    } finally {
      state.running = undefined;
    }
  };
}
