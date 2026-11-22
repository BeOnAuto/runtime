import { join } from 'node:path';

import { Effect } from 'effect';
import { expect, it } from 'vitest';

import { HostElsewhere } from '../host/run-requests.ts';
import { hostLease, type LeaseClaim } from '../lease/host-lease.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, leaseOn, openedOn } from '../testing/host-files.ts';
import { databaseSettingsOf, hostIn, processesStartAt, type ProcessDatabasesOf } from '../testing/host-processes.ts';
import { furtherWakeUpsSuite } from './further-wake-ups-suite.ts';
import { clockAt, steppedHostOn, steppedOn } from './stepped-hosts.ts';

/** Whose clock judges a claim: the database's, where the servers share one, or each host's own. */
export type ClaimClock = 'database' | 'host';

const anHourMs = 3_600_000;

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const shortestSweepMs = 10;

const listening = workflow('do:\n  - approval: { listen: { to: { one: { with: { type: com.acme.approved } } } } }');

const notesOfAHostAnHourAhead: Readonly<Record<ClaimClock, readonly Readonly<Record<string, string>>[]>> = {
  database: [{ kind: 'standing_by', holder: 'first' }],
  host: [],
};

/** Who holds the claim after a host claims it: the host itself, or the holder it found. */
function holderAfter(claimant: string, claim: LeaseClaim): string {
  return claim.held ? claimant : claim.holder;
}

const holdersTwoHoursOn: Readonly<Record<ClaimClock, string>> = { database: 'second', host: 'third' };

function claimLengthsSuite(databases: ProcessDatabasesOf, claimClock: ClaimClock): void {
  it(`takes a claim already past its length at once, and judges a long one by the clock of the ${claimClock}, however far the hosts' own clocks are moved`, async () => {
    const leases = await openedOn(databaseSettingsOf(await databases()));
    const holderOnceClaimed = async (claimant: string, lastsMs: number, now: number) =>
      holderAfter(claimant, await Effect.runPromise(hostLease(leases, claimant, lastsMs, clockAt(now)).claimed()));

    const holders = [
      await holderOnceClaimed('first', -1, processesStartAt),
      await holderOnceClaimed('second', anHourMs, processesStartAt),
      await holderOnceClaimed('third', anHourMs, processesStartAt + 2 * anHourMs),
    ];

    expect(holders).toEqual(['first', 'second', holdersTwoHoursOn[claimClock]]);
  });
}

export function claimSuite(databases: ProcessDatabasesOf, claimClock: ClaimClock): void {
  it('keeps the claim of a host paused for a second at the shortest sweep, so no other host takes over', async () => {
    const database = await databases();
    const first = hostIn(database, 'hang-on-call', join(aSQLiteFile(), '..', 'settlements.jsonl'), shortestSweepMs);
    await first.said('calling');
    const leases = await openedOn(databaseSettingsOf(database));
    const { hosted: second, clock } = await steppedHostOn(database, { sweepEveryMs: shortestSweepMs });
    const held = await leaseOn(leases);

    await steppedOn(clock, 1000);
    await first.stepped(1000);
    const renewed = await leaseOn(leases);
    const refused = await Effect.runPromise(Effect.flip(second.host.start(runAt(runId), startOf(listening))));

    expect(renewed.holder).toBe(held.holder);
    expect(renewed.expires_at).not.toBe(held.expires_at);
    expect(refused).toBeInstanceOf(HostElsewhere);
    expect(second.notes().map(({ kind }) => kind)).toEqual(['standing_by']);
    expect(second.calls()).toEqual([]);
  });

  it(`judges the claim by the clock of the ${claimClock}, as a host whose clock runs an hour ahead finds`, async () => {
    const database = await databases();
    await steppedHostOn(database, { holder: 'first' });
    const { hosted: ahead } = await steppedHostOn(database, { holder: 'ahead' }, processesStartAt + anHourMs);

    expect(ahead.notes()).toMatchObject(notesOfAHostAnHourAhead[claimClock]);
  });

  claimLengthsSuite(databases, claimClock);
  furtherWakeUpsSuite(databases);
}
