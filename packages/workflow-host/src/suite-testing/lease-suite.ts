import { join } from 'node:path';

import { Effect } from 'effect';
import { expect, it } from 'vitest';

import { HostElsewhere } from '../host/run-requests.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, leaseOn, leasesLapsed, openedOn } from '../testing/host-files.ts';
import { databaseSettingsOf, hostIn, type ProcessDatabasesOf } from '../testing/host-processes.ts';
import { fewSweeps, steppedBy } from '../testing/stepped-clock.ts';
import { claimSuite, type ClaimClock } from './claim-suite.ts';
import { leasesSweptBy, steppedHostOn } from './stepped-hosts.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const sweepEveryMs = 400;

const listening = workflow('do:\n  - approval: { listen: { to: { one: { with: { type: com.acme.approved } } } } }');

export function leaseSuite(databases: ProcessDatabasesOf, claimClock: ClaimClock): void {
  it('lets one host serve the workflows of a database, and a second take them over only once the first is gone, loading the run the first left from the ledger', async () => {
    const database = await databases();
    const first = hostIn(database, 'hang-on-call', join(aSQLiteFile(), '..', 'settlements.jsonl'), sweepEveryMs);
    await first.said('calling');
    const leases = await openedOn(databaseSettingsOf(database));
    const { hosted: second, clock } = await steppedHostOn(database, { sweepEveryMs });
    second.know(runId);

    const refused = await Effect.runPromise(Effect.flip(second.host.start(runAt(runId), startOf(listening))));
    const held = await leaseOn(leases);
    const renewed = await leasesSweptBy({ first, second: clock, leases, everyMs: sweepEveryMs }, 3);
    const performedWhileBothRan = second.calls().length;
    await first.killed();
    await leasesLapsed(leases);
    const settled = await steppedBy(clock, sweepEveryMs).until(
      () => second.settlements(),
      (settlements) => settlements.size > 0,
      fewSweeps,
    );

    expect(refused).toBeInstanceOf(HostElsewhere);
    expect(renewed.map(({ holder }) => holder)).toEqual([held.holder, held.holder, held.holder]);
    expect(new Set([held, ...renewed].map(({ expires_at: expiresAt }) => expiresAt)).size).toBe(4);
    expect(performedWhileBothRan).toBe(0);
    expect(second.notes().map(({ kind }) => kind)).toEqual(['standing_by', 'took_over', 'run_reloaded']);
    expect(second.calls()).toHaveLength(1);
    expect([...settled.keys()]).toEqual([runId]);
  });

  it('hands the workflows over at the next sweep when the host serving them stops', async () => {
    const database = await databases();
    const { hosted: first } = await steppedHostOn(database, { sweepEveryMs, holder: 'first' });
    const { hosted: second, clock } = await steppedHostOn(database, { sweepEveryMs, holder: 'second' });

    await first.host.stop();
    const notes = await steppedBy(clock, sweepEveryMs).until(
      () => second.notes(),
      (noted) => noted.length > 1,
      fewSweeps,
    );

    expect(notes).toMatchObject([
      { kind: 'standing_by', holder: 'first' },
      { kind: 'took_over', holder: 'second' },
    ]);
  });

  claimSuite(databases, claimClock);
}
