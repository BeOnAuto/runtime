import { join } from 'node:path';

import { Effect } from 'effect';
import { expect, it } from 'vitest';

import { HostElsewhere } from '../host/run-requests.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, leaseOn, openedOn, untilRenewedBy } from '../testing/host-files.ts';
import { databaseSettingsOf, hostIn, type ProcessDatabasesOf } from '../testing/host-processes.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const sweepEveryMs = 400;

const shortestSweepMs = 10;

const anHourMs = 3_600_000;

const listening = workflow('do:\n  - approval: { listen: { to: { one: { with: { type: com.acme.approved } } } } }');

export type ClaimClock = 'database' | 'host';

const notesOfAHostAnHourAhead: Readonly<Record<ClaimClock, readonly Readonly<Record<string, string>>[]>> = {
  database: [{ kind: 'standing_by', holder: 'first' }],
  host: [],
};

export function leaseSuite(databases: ProcessDatabasesOf): void {
  it('lets one host serve the workflows of a database, and a second take them over only once the first is gone', async () => {
    const database = await databases();
    const first = hostIn(database, 'hang-on-call', join(aSQLiteFile(), '..', 'settlements.jsonl'), sweepEveryMs);
    await first.said('calling');
    const leases = await openedOn(databaseSettingsOf(database));
    const second = await hostedOn(databaseSettingsOf(database), { sweepEveryMs });
    second.know(runId);

    const refused = await Effect.runPromise(Effect.flip(second.host.start(runAt(runId), startOf(listening))));
    const held = await leaseOn(leases);
    await untilRenewedBy(leases, held, 3);
    const performedWhileBothRan = second.calls().length;
    await first.killed();
    const settled = await until(second.settlements, (settlements) => settlements.size > 0);

    expect(refused).toBeInstanceOf(HostElsewhere);
    expect(performedWhileBothRan).toBe(0);
    expect(second.notes().map(({ kind }) => kind)).toEqual(['standing_by', 'took_over']);
    expect(second.calls()).toHaveLength(1);
    expect([...settled.keys()]).toEqual([runId]);
  });

  it('hands the workflows over at the next sweep when the host serving them stops', async () => {
    const database = await databases();
    const first = await hostedOn(databaseSettingsOf(database), { sweepEveryMs, holder: 'first' });
    const second = await hostedOn(databaseSettingsOf(database), { sweepEveryMs, holder: 'second' });

    await first.host.stop();
    const notes = await until(second.notes, (noted) => noted.length > 1);

    expect(notes).toMatchObject([
      { kind: 'standing_by', holder: 'first' },
      { kind: 'took_over', holder: 'second' },
    ]);
  });
}

export function claimSuite(databases: ProcessDatabasesOf, claimClock: ClaimClock): void {
  it('keeps the claim of a host paused for a second at the shortest sweep, so no other host takes over', async () => {
    const database = await databases();
    const first = hostIn(database, 'hang-on-call', join(aSQLiteFile(), '..', 'settlements.jsonl'), shortestSweepMs);
    await first.said('calling');
    const leases = await openedOn(databaseSettingsOf(database));
    const second = await hostedOn(databaseSettingsOf(database), { sweepEveryMs: shortestSweepMs });
    const held = await leaseOn(leases);

    await first.paused(1000);
    await untilRenewedBy(leases, held, 1);
    const refused = await Effect.runPromise(Effect.flip(second.host.start(runAt(runId), startOf(listening))));

    expect(refused).toBeInstanceOf(HostElsewhere);
    expect(second.notes().map(({ kind }) => kind)).toEqual(['standing_by']);
    expect(second.calls()).toEqual([]);
  });

  it(`judges the claim by the clock of the ${claimClock}, as a host whose clock runs an hour ahead finds`, async () => {
    const database = await databases();
    await hostedOn(databaseSettingsOf(database), { holder: 'first' });
    const ahead = await hostedOn(databaseSettingsOf(database), {
      holder: 'ahead',
      clock: { now: () => Date.now() + anHourMs, sleep: Effect.sleep },
    });

    expect(ahead.notes()).toMatchObject(notesOfAHostAnHourAhead[claimClock]);
  });
}
