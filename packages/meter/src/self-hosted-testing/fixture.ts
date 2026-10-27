import {
  STANDARD_OFFLINE_MILLISECONDS,
  type LicenseCapability,
  type OfflineAllocation,
  type OfflineUsageReport,
} from '@on.auto/metering';

import { openSelfHostedMeter, type LicenseFetch } from '../index.ts';
import { reportAuthority } from '../offline-testing/report-authority.ts';
import { testClock } from '../testing/clock-fixture.ts';
import { licenseAuthority } from '../testing/license-authority.ts';
import { licenseFixture } from '../testing/license-fixture.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

type Signing = Readonly<
  Pick<
    Awaited<ReturnType<typeof licenseFixture>>,
    'trust' | 'installation' | 'challenge' | 'bundle' | 'timeToken' | 'allocationToken'
  >
>;

function initialAllocation(signing: Signing): OfflineAllocation {
  return {
    issuer: signing.trust.issuer,
    ring: signing.trust.ring,
    clusterId: signing.installation.clusterId,
    installationKeyDigest: signing.installation.installationKeyDigest,
    accountId: 'account-1',
    installationId: 'installation-1',
    id: 'allocation-1',
    epoch: 1,
    mode: 'standard',
    issuedAt: 5000,
    expiresAt: 5000 + STANDARD_OFFLINE_MILLISECONDS,
    sources: [
      {
        lotId: 'welcome-1',
        source: 'welcome',
        issuedAt: 5000,
        expiresAt: 5000 + STANDARD_OFFLINE_MILLISECONDS,
        units: 5_000_000n,
      },
    ],
  };
}

export async function selfHostedFixture(
  open = sqliteDatabase,
  capabilities: readonly LicenseCapability[] = ['reasoning', 'prediction'],
) {
  const signing = await licenseFixture(open);
  const time = testClock();
  const allocation = initialAllocation(signing);
  const state: { allocations: readonly OfflineAllocation[] } = { allocations: [allocation] };
  const authority = allocatingAuthority(signing, state, time.pass, capabilities);
  const received: OfflineUsageReport[] = [];
  const report = reportAuthority({
    connection: signing.database.connection,
    installation: signing.installation,
    now: () => authority.state.now,
    received: (value) => {
      received.push(value);
    },
  });
  const fetch: LicenseFetch = (request) =>
    new URL(request.url).pathname === '/licenses/usage-reports' ? report(request) : authority.fetch(request);
  const options = {
    connection: time.on(signing.database.connection),
    secrets: signing.database.secrets,
    trust: signing.trust,
    clock: time.samples,
    fetch,
  };
  const meter = await openSelfHostedMeter(options);
  function pass(elapsed: number) {
    time.pass(elapsed);
    authority.state.now += elapsed;
  }
  async function restart() {
    const database = await signing.database.reopen();
    return openSelfHostedMeter({ ...options, connection: time.on(database.connection), secrets: database.secrets });
  }
  return { ...signing, meter, options, time, authority, allocation, state, received, pass, restart };
}

function allocatingAuthority(
  signing: Signing,
  state: Readonly<{ allocations: readonly OfflineAllocation[] }>,
  pass: (elapsed: number) => void,
  capabilities: readonly LicenseCapability[],
) {
  return licenseAuthority(
    {
      ...signing,
      bundle: async (challenge, changes) =>
        signing.bundle(
          challenge,
          {
            ...changes,
            capabilities,
            allocationIds: state.allocations.map((value) => value.id),
            grantIds: [...new Set(state.allocations.flatMap((value) => value.sources.map((source) => source.lotId)))],
          },
          await Promise.all(state.allocations.map(signing.allocationToken)),
        ),
    },
    pass,
  );
}
