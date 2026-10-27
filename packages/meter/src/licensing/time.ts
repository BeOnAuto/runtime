import { licenseTimeVerifier, type LicenseTrust } from '@on.auto/metering';
import { Schema } from 'effect';

import type { TrustedTime } from '../clock/records.ts';
import { clockMilliseconds } from '../clock/time-samples.ts';
import type { LicenseTransport } from './records.ts';

const timeBody = Schema.decodeUnknownSync(Schema.Struct({ timeToken: Schema.String }));

export function freshLicenseTime(
  trust: LicenseTrust,
  send: LicenseTransport,
  monotonicTime: () => number,
): () => Promise<TrustedTime> {
  const verify = licenseTimeVerifier(trust);
  return async () => {
    const requestId = crypto.randomUUID();
    const started = clockMilliseconds(Math.floor(monotonicTime()));
    const { timeToken } = timeBody(await send('/licenses/time', { requestId }));
    const attestation = await verify(timeToken, requestId);
    const elapsed = clockMilliseconds(Math.ceil(monotonicTime()) - started);
    if (elapsed > 30_000) throw new Error('license_time_delayed');
    return { id: `time_${requestId}`, serverTime: clockMilliseconds(attestation.serverTime + elapsed) };
  };
}
