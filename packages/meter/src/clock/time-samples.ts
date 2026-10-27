import type { ConnectionPorts } from '@on.auto/ledger';

import type { ClockSample, ClockSamples, TrustedTime } from './records.ts';

export function clockMilliseconds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000)
    throw new Error('license_clock_invalid');
  return value;
}

export function assertTrustedTime(value: TrustedTime): void {
  if (!/^[A-Za-z0-9_.:-]{1,256}$/u.test(value.id)) throw new Error('license_clock_proof_invalid');
  clockMilliseconds(value.serverTime);
}

export function clockSamplesOn(connection: ConnectionPorts, samples: ClockSamples): () => Promise<ClockSample> {
  const wallTime = connection.sharedClock ?? (() => Promise.resolve(samples.wallTime()));
  return async () => ({
    wall: clockMilliseconds(await wallTime()),
    monotonic: clockMilliseconds(Math.floor(samples.monotonicTime())),
  });
}
