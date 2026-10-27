import type { ConnectionPorts } from '@on.auto/ledger';

import type { LicenseClient, LicensePollResult } from '../license-client/records.ts';
import { readLicenseHistory } from '../license-state/reading.ts';
import type { CurrentLicense } from '../license-state/records.ts';
import { readLicenseBundle } from '../licensing/bundle.ts';
import type { OfflineCapacity } from '../offline-capacity/records.ts';

async function installTokens(capacity: OfflineCapacity, tokens: readonly string[], index = 0): Promise<void> {
  const token = tokens[index];
  if (token === undefined) return;
  await capacity.install(token);
  return installTokens(capacity, tokens, index + 1);
}

async function installFor(
  connection: ConnectionPorts,
  capacity: OfflineCapacity,
  current: CurrentLicense,
): Promise<CurrentLicense> {
  const history = await readLicenseHistory(connection, current.license.serial);
  if (history === undefined) throw new Error('license_history_unavailable');
  const allocationTokens: unknown = JSON.parse(history.allocationJson);
  const bundle = readLicenseBundle({
    entitlementToken: history.token,
    allocationTokens,
  });
  if (
    JSON.stringify(bundle.allocationTokens) !== history.allocationJson ||
    bundle.allocationTokens.length !== current.license.allocationIds.length
  )
    throw new Error('license_allocation_history_invalid');
  await installTokens(capacity, bundle.allocationTokens);
  return current;
}

export function capacityLicenseClient(
  connection: ConnectionPorts,
  client: LicenseClient,
  capacity: OfflineCapacity,
): LicenseClient {
  const installed = (current: CurrentLicense) => installFor(connection, capacity, current);
  return {
    ...client,
    activate: async (activationKey) => installed(await client.activate(activationKey)),
    refresh: async () => installed(await client.refresh()),
    resume: async () => {
      const current = await client.resume();
      return current === undefined ? undefined : installed(current);
    },
    poll: async (): Promise<LicensePollResult> => {
      const result = await client.poll();
      if (result.status === 'failed') return result;
      try {
        if ((await client.head()).state === 'active') await installed(await client.current());
        return result;
      } catch {
        return { status: 'failed', retryInMilliseconds: Math.min(result.retryInMilliseconds, 30_000) };
      }
    },
  };
}
