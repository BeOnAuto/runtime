import { STANDARD_OFFLINE_MILLISECONDS, type OfflineAllocation } from '@on.auto/metering';

import { openLicenseClock, openLicenseState, openOfflineCapacity } from '../index.ts';
import { testClock } from './clock-fixture.ts';
import { licenseFixture } from './license-fixture.ts';
import { sqliteDatabase } from './sqlite-database.ts';

export async function capacityFixture(open = sqliteDatabase) {
  const f = await licenseFixture(open);
  const time = testClock();
  const connection = time.on(f.database.connection);
  const clock = await openLicenseClock(connection, time.samples);
  await clock.synchronize({ id: 'time-1', serverTime: 5000 });
  const licenses = await openLicenseState({ connection, installation: f.installation, trust: f.trust });
  const allocation: OfflineAllocation = {
    issuer: f.trust.issuer,
    ring: f.trust.ring,
    clusterId: f.installation.clusterId,
    installationKeyDigest: f.installation.installationKeyDigest,
    accountId: 'account-1',
    installationId: 'installation-1',
    id: 'allocation-1',
    epoch: 1,
    mode: 'standard',
    issuedAt: 5000,
    expiresAt: 5000 + STANDARD_OFFLINE_MILLISECONDS,
    sources: [
      { lotId: 'welcome-1', source: 'welcome', issuedAt: 1000, expiresAt: 10_000, units: 2_000_000n },
      { lotId: 'free-1', source: 'free', issuedAt: 1000, expiresAt: 20_000, units: 3_000_000n },
    ],
  };
  async function authorize(value: OfflineAllocation) {
    const head = await licenses.head();
    const challenge = { ...(await f.challenge('activate', crypto.randomUUID())), generation: head.generation };
    const token = await f.allocationToken(value);
    const bundle = await f.bundle(
      challenge,
      { allocationIds: [value.id], grantIds: value.sources.map((source) => source.lotId) },
      [token],
    );
    await licenses.record({ expectedRevision: head.revision, challenge, ...bundle, now: 5000 });
    return token;
  }
  const token = await authorize(allocation);
  const options = { connection, clock, licenses, trust: f.trust };
  const capacity = await openOfflineCapacity(options);
  async function replica() {
    const database = await f.database.reopen();
    return openOfflineCapacity({ ...options, connection: database.connection });
  }
  return { ...f, time, clock, licenses, options, allocation, token, capacity, authorize, replica };
}
