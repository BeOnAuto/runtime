import type { ConnectionPorts } from '@on.auto/ledger';

import { retryChange } from '../database/retry-change.ts';
import { prepareMeter } from '../database/schema.ts';
import { advanceClock, alreadyTrusted, readClock, trustClock } from './clock-store.ts';
import { clockEstimator } from './estimates.ts';
import type { ClockSamples, LicenseClock, LicenseTime, TrustedTime } from './records.ts';
import { assertTrustedTime, clockSamplesOn } from './time-samples.ts';

async function refreshedClock(
  connection: ConnectionPorts,
  fresh: TrustedTime,
  sample: ReturnType<typeof clockSamplesOn>,
): Promise<void> {
  assertTrustedTime(fresh);
  await retryChange(async () => {
    if (await alreadyTrusted(connection, fresh)) return true;
    const before = await readClock(connection);
    if (fresh.serverTime < before.serverAnchor) {
      if (await alreadyTrusted(connection, fresh)) return true;
      throw new Error('license_clock_trust_regressed');
    }
    try {
      return (await trustClock(connection, before, fresh, await sample())) ? true : undefined;
    } catch (error) {
      if (await alreadyTrusted(connection, fresh)) return true;
      throw error;
    }
  });
}

export async function openLicenseClock(connection: ConnectionPorts, samples: ClockSamples): Promise<LicenseClock> {
  await prepareMeter(connection);
  const sample = clockSamplesOn(connection, samples);
  const initial = await readClock(connection);
  const estimate = clockEstimator(initial, (await sample()).monotonic);
  const read = (): Promise<LicenseTime> =>
    retryChange(async () => {
      const before = await readClock(connection);
      const next = estimate(before, await sample());
      return (await advanceClock(connection, before, next))
        ? { now: next.now, onlineRequired: next.onlineRequired }
        : undefined;
    });
  return {
    read,
    synchronize: async (fresh) => {
      await refreshedClock(connection, fresh, sample);
      return read();
    },
  };
}
