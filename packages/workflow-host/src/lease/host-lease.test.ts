import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import type { HostClock } from '../loop/host-clock.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostLease, leaseMsFor, shortestLeaseMs } from './host-lease.ts';

const anHourMs = 3_600_000;

function clockAt(now: number): HostClock {
  return { now: () => now, sleep: (milliseconds) => Effect.sleep(milliseconds) };
}

interface SharedClock {
  readonly database: HostDatabase;
  readonly at: (now: number) => void;
}

function withSharedClock(database: HostDatabase): SharedClock {
  const time = { now: 1_790_845_200_000 };
  return {
    database: { ...database, sharedClock: Effect.sync(() => time.now) },
    at: (now) => {
      time.now = now;
    },
  };
}

describe('the claim of a host on the workflows of its database', () => {
  it('lasts three sweeps, and never less than three seconds', () => {
    expect([leaseMsFor(10), leaseMsFor(1000), leaseMsFor(5000)]).toEqual([shortestLeaseMs, shortestLeaseMs, 15_000]);
  });

  it('is judged by the clock the servers share, where the database has one, whatever the clock of each host', async () => {
    const shared = withSharedClock(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
    const first = hostLease(shared.database, 'first', shortestLeaseMs, clockAt(0));
    const anHourAhead = hostLease(shared.database, 'second', shortestLeaseMs, clockAt(anHourMs));

    const held = await Effect.runPromise(first.claimed());
    const refused = await Effect.runPromise(anHourAhead.claimed());
    shared.at(1_790_845_200_000 + shortestLeaseMs + 1);
    const lapsed = await Effect.runPromise(anHourAhead.claimed());

    expect([held, refused, lapsed]).toEqual([
      { held: true },
      { held: false, holder: 'first', until: 1_790_845_200_000 + shortestLeaseMs },
      { held: true },
    ]);
  });

  it('is judged by the clock of the host on a database that one process holds', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const first = hostLease(database, 'first', shortestLeaseMs, clockAt(0));
    const anHourAhead = hostLease(database, 'second', shortestLeaseMs, clockAt(anHourMs));

    await Effect.runPromise(first.claimed());

    expect(await Effect.runPromise(anHourAhead.claimed())).toEqual({ held: true });
  });
});
