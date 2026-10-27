import {
  allocationPayload,
  allocationVerifier,
  MOST_ALLOCATION_TOKEN_CHARACTERS,
  offlineCheckpoint,
} from '@on.auto/metering';

import { readClock } from '../clock/clock-store.ts';
import { capacityReceipt, readCapacityHead } from './reading.ts';
import type { CapacityAuthority, CapacityOptions, CapacityReceipt } from './records.ts';
import { writeCapacity } from './writing.ts';

interface InstallationOptions extends CapacityOptions {
  readonly verify: ReturnType<typeof allocationVerifier>;
}

async function authorityFor(options: CapacityOptions): Promise<CapacityAuthority> {
  const license = await options.licenses.current(await options.clock.read());
  const clock = await readClock(options.connection);
  if (clock.onlineRequired) throw new Error('license_clock_untrusted');
  return { license, clockRevision: clock.revision, clockEpoch: clock.epoch, now: clock.highWater };
}

async function installAttempt(
  options: InstallationOptions,
  token: string,
  digest: string,
): Promise<CapacityReceipt | undefined> {
  const before = await readCapacityHead(options.connection);
  if (before.currentId !== null && before.state !== 'closed') throw new Error('offline_allocation_unresolved');
  if (before.revision === Number.MAX_SAFE_INTEGER || before.epoch === Number.MAX_SAFE_INTEGER)
    throw new Error('offline_capacity_exhausted');
  const authority = await authorityFor(options);
  const allocation = await options.verify(token, {
    license: authority.license.license,
    now: authority.now,
    minimumEpoch: before.epoch + 1,
  });
  const installed = await writeCapacity(options.connection, {
    before,
    authority,
    allocation,
    token,
    tokenDigest: digest,
    checkpoint: await offlineCheckpoint(allocationPayload(allocation)),
  });
  return installed ? { id: allocation.id, epoch: allocation.epoch, state: 'open' } : undefined;
}

async function installOrRecover(
  options: InstallationOptions,
  token: string,
  digest: string,
  attempts: number,
): Promise<CapacityReceipt & { readonly status: 'installed' | 'existing' }> {
  if (attempts === 0) throw new Error('offline_capacity_contended');
  const existing = () => capacityReceipt(options.connection, token, digest);
  const previous = await existing();
  if (previous !== undefined) return { ...previous, status: 'existing' };
  try {
    const installed = await installAttempt(options, token, digest);
    if (installed !== undefined) return { ...installed, status: 'installed' };
  } catch (error) {
    const recovered = await existing();
    if (recovered !== undefined) return { ...recovered, status: 'existing' };
    throw error;
  }
  return installOrRecover(options, token, digest, attempts - 1);
}

export function capacityInstaller(options: CapacityOptions) {
  const captured = { ...options, verify: allocationVerifier(options.trust) };
  return async (token: string) => {
    if (token.length === 0 || token.length > MOST_ALLOCATION_TOKEN_CHARACTERS)
      throw new Error('offline_capacity_token_invalid');
    return installOrRecover(captured, token, await offlineCheckpoint(token), 128);
  };
}
