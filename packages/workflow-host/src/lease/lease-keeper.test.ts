import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { DatabaseFailed } from '../database/host-database.ts';
import { until } from '../testing/until.ts';
import type { HostLease, LeaseClaim } from './host-lease.ts';
import { keptLease } from './lease-keeper.ts';

interface Keeping {
  readonly said: () => readonly string[];
  readonly answer: (answer: LeaseClaim | 'unreachable') => void;
  readonly at: (now: number) => void;
  readonly attemptsRenewed: () => number;
}

const unreachable = new DatabaseFailed({ detail: 'The database cannot be reached' });

interface KeptState {
  answer: LeaseClaim | 'unreachable';
  now: number;
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

async function keeping(first: LeaseClaim, attempts: 'renewed' | 'unreachable' = 'renewed'): Promise<Keeping> {
  const state: KeptState = { answer: first, now: 0, renewals: 0 };
  const said: string[] = [];
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
    clock: { now: () => state.now, sleep: (milliseconds) => Effect.sleep(milliseconds) },
    sweepEveryMs: 5,
    lastsMs: 15,
    held: (before) => saying(`held after ${before}`),
    standingBy: ({ holder }, before) => saying(`standing by for ${holder} after ${before}`),
    trouble: (what) => saying(what),
  });
  onTestFinished(() => keeper.stop());
  return {
    said: () => said,
    answer: (answer) => {
      state.answer = answer;
    },
    at: (now) => {
      state.now = now;
    },
    attemptsRenewed: () => state.renewals,
  };
}

const elsewhere: LeaseClaim = { held: false, holder: 'another-server', until: 15 };

describe('the keeper of the claim of a host', () => {
  it('stands by while another server holds the claim, and serves once it gets it, saying each once', async () => {
    const kept = await keeping(elsewhere);
    await until(kept.said, (said) => said.length > 0);
    kept.answer({ held: true });

    const said = await until(kept.said, (lines) => lines.length > 1);

    expect(said).toEqual(['standing by for another-server after unknown', 'held after standing_by']);
  });

  it('stands down once it could not renew its claim for as long as a claim lasts', async () => {
    const kept = await keeping({ held: true });
    kept.answer('unreachable');
    await until(kept.said, (said) => said.length > 1);
    kept.at(15);

    const said = await until(kept.said, (lines) => lines.some((line) => line.startsWith('standing by')));

    const standingBy = said.filter((line) => line.startsWith('standing by'));
    const troubles = said.filter((line) => line.startsWith('The claim'));

    expect(said.at(0)).toBe('held after unknown');
    expect(standingBy).toEqual(['standing by for unknown, since the database could not be read after holding']);
    expect(new Set(troubles)).toEqual(
      new Set(['The claim of this server on the workflows of its database could not be renewed']),
    );
    expect(said).toHaveLength(1 + standingBy.length + troubles.length);
  });
});

describe('the keeper of the leases of the attempts a server holds', () => {
  it('renews them in each tick of the claim, while the server stands by as while it serves', async () => {
    const kept = await keeping(elsewhere);

    await until(kept.attemptsRenewed, (renewals) => renewals > 2);

    expect(kept.said()).toEqual(['standing by for another-server after unknown']);
  });

  it('says when they could not be renewed, and keeps the claim of the server as it was', async () => {
    const kept = await keeping({ held: true }, 'unreachable');

    const said = await until(kept.said, (lines) => lines.length > 2);

    expect(said.at(0)).toBe('held after unknown');
    expect(new Set(said.slice(1))).toEqual(
      new Set(['The leases of the attempts this server holds could not be renewed; the next sweep renews them']),
    );
  });
});
