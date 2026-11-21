import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { DatabaseFailed } from '../database/host-database.ts';
import { steppedClock, type SteppedClock } from '../testing/stepped-clock.ts';
import type { HostLease, LeaseClaim } from './host-lease.ts';
import { keptLease } from './lease-keeper.ts';

interface Keeping {
  readonly said: () => readonly string[];
  readonly answer: (answer: LeaseClaim | 'unreachable') => void;
  readonly sweeps: (count: number) => Promise<void>;
  readonly attemptsRenewed: () => number;
  readonly asked: () => readonly number[];
}

const unreachable = new DatabaseFailed({ detail: 'The database cannot be reached' });

const sweepEveryMs = 5;

interface KeptState {
  answer: LeaseClaim | 'unreachable';
  renewals: number;
}

function leaseAnswering(state: Readonly<KeptState>): HostLease {
  return {
    holder: 'this-server',
    claimed: () =>
      Effect.suspend(() => (state.answer === 'unreachable' ? Effect.fail(unreachable) : Effect.succeed(state.answer))),
    released: () => Effect.void,
  };
}

function recordedClock(): {
  readonly clock: SteppedClock;
  readonly asked: () => readonly number[];
  readonly recorded: (milliseconds: number) => Effect.Effect<void>;
} {
  const clock = steppedClock(0);
  const asked: number[] = [];
  return {
    clock,
    asked: () => asked,
    recorded: (milliseconds) =>
      Effect.suspend(() => {
        asked.push(milliseconds);
        return clock.sleep(milliseconds);
      }),
  };
}

async function keeping(
  first: LeaseClaim,
  attempts: 'renewed' | 'unreachable' = 'renewed',
  through: 'sleeps' | 'sweeps' = 'sleeps',
): Promise<Keeping> {
  const state: KeptState = { answer: first, renewals: 0 };
  const said: string[] = [];
  const { clock, recorded, asked } = recordedClock();
  const saying = (line: string) =>
    Effect.sync(() => {
      said.push(line);
    });
  const keeper = await keptLease({
    lease: leaseAnswering(state),
    attemptsRenewed: Effect.suspend(() => {
      state.renewals += 1;
      return attempts === 'renewed' ? Effect.void : Effect.fail(unreachable);
    }),
    clock:
      through === 'sweeps'
        ? { now: clock.now, sleep: () => Effect.die(new Error('A sweep waits through sweeps')), sweeps: recorded }
        : { now: clock.now, sleep: recorded },
    sweepEveryMs,
    lastsMs: 15,
    held: (before) => saying(`held after ${before}`),
    standingBy: ({ holder }, before) => saying(`standing by for ${holder} after ${before}`),
    trouble: (what) => saying(what),
  });
  onTestFinished(() => keeper.stop());
  await clock.when(clock.asleep, (sleeping) => sleeping > 0);
  return {
    said: () => said,
    answer: (answer) => {
      state.answer = answer;
    },
    sweeps: async function swept(count) {
      if (count === 0) {
        return;
      }
      clock.step(sweepEveryMs);
      await clock.when(clock.asleep, (sleeping) => sleeping > 0);
      await swept(count - 1);
    },
    attemptsRenewed: () => state.renewals,
    asked,
  };
}

const elsewhere: LeaseClaim = { held: false, holder: 'another-server', until: 15 };

describe('the keeper of the claim of a host', () => {
  it('stands by while another server holds the claim, and serves once it gets it, saying each once', async () => {
    const kept = await keeping(elsewhere);
    kept.answer({ held: true });

    await kept.sweeps(2);

    expect(kept.said()).toEqual(['standing by for another-server after unknown', 'held after standing_by']);
  });

  it('stands down once it could not renew its claim for as long as a claim lasts', async () => {
    const kept = await keeping({ held: true });
    kept.answer('unreachable');

    await kept.sweeps(2);
    const beforeItLapsed = [...kept.said()];
    await kept.sweeps(1);
    const said = kept.said();

    const standingBy = said.filter((line) => line.startsWith('standing by'));
    const troubles = said.filter((line) => line.startsWith('The claim'));

    expect(beforeItLapsed.some((line) => line.startsWith('standing by'))).toBe(false);
    expect(said.at(0)).toBe('held after unknown');
    expect(standingBy).toEqual(['standing by for unknown, since the database could not be read after holding']);
    expect(new Set(troubles)).toEqual(
      new Set(['The claim of this server on the workflows of its database could not be renewed']),
    );
    expect(said).toHaveLength(1 + standingBy.length + troubles.length);
  });

  it('sleeps between its sweeps on the clock it is given, a sweep apart', async () => {
    const kept = await keeping(elsewhere);

    await kept.sweeps(3);

    expect(kept.asked()).toEqual([sweepEveryMs, sweepEveryMs, sweepEveryMs, sweepEveryMs]);
  });

  it('waits between its sweeps through the sweeps of its clock, where the clock has them', async () => {
    const kept = await keeping(elsewhere, 'renewed', 'sweeps');

    await kept.sweeps(1);

    expect([kept.asked(), kept.attemptsRenewed()]).toEqual([[sweepEveryMs, sweepEveryMs], 2]);
  });
});

describe('the keeper of the leases of the attempts a server holds', () => {
  it('renews them in each tick of the claim, while the server stands by as while it serves', async () => {
    const kept = await keeping(elsewhere);

    await kept.sweeps(2);

    expect(kept.attemptsRenewed()).toBe(3);
    expect(kept.said()).toEqual(['standing by for another-server after unknown']);
  });

  it('says when they could not be renewed, and keeps the claim of the server as it was', async () => {
    const kept = await keeping({ held: true }, 'unreachable');

    await kept.sweeps(2);
    const said = kept.said();

    expect(said.at(0)).toBe('held after unknown');
    expect(said.length).toBeGreaterThan(2);
    expect(new Set(said.slice(1))).toEqual(
      new Set(['The leases of the attempts this server holds could not be renewed; the next sweep renews them']),
    );
  });
});
