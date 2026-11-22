import type { HostDatabase } from '../database/host-database.ts';
import { leaseOn, type Lease } from '../testing/host-files.ts';
import {
  databaseSettingsOf,
  processesStartAt,
  type HostProcess,
  type ProcessDatabase,
} from '../testing/host-processes.ts';
import { hostedOn, type HostedRuns } from '../testing/host-runs.ts';
import { steppedClock, type SteppedClock } from '../testing/stepped-clock.ts';

interface SteppedHost {
  readonly hosted: HostedRuns;
  readonly clock: SteppedClock;
}

/** A host of the test on a clock of its own, which starts where the clocks of the hosts in other processes start. */
export async function steppedHostOn(
  database: ProcessDatabase,
  options: Omit<Parameters<typeof hostedOn>[1] & object, 'clock' | 'context'> = {},
  startsAt = processesStartAt,
): Promise<SteppedHost> {
  const clock = steppedClock(startsAt);
  const hosted = await hostedOn(databaseSettingsOf(database), { ...options, clock, context: clock.watching() });
  return { hosted, clock };
}

/** Steps a clock from its rest by the time given, and answers once the host on it is at rest again. */
export async function steppedOn(clock: SteppedClock, milliseconds: number): Promise<void> {
  await clock.atRest();
  clock.step(milliseconds);
  await clock.atRest();
}

interface BothHosts {
  readonly first: HostProcess;
  readonly second: SteppedClock;
  readonly leases: HostDatabase;
  readonly everyMs: number;
}

/** The lease as it stands after each of a number of sweeps of both hosts, the one in the process first. */
export async function leasesSweptBy(both: BothHosts, sweeps: number): Promise<readonly Lease[]> {
  if (sweeps === 0) {
    return [];
  }
  await both.first.stepped(both.everyMs);
  await steppedOn(both.second, both.everyMs);
  const lease = await leaseOn(both.leases);
  return [lease, ...(await leasesSweptBy(both, sweeps - 1))];
}

/** A clock standing at a moment, for a claim made at that moment. */
export function clockAt(now: number): SteppedClock {
  return steppedClock(now);
}
