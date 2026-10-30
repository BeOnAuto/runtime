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
}

async function keeping(first: LeaseClaim): Promise<Keeping> {
  const state: { answer: LeaseClaim | 'unreachable'; now: number } = { answer: first, now: 0 };
  const said: string[] = [];
  const lease: HostLease = {
    holder: 'this-server',
    claimed: () =>
      Effect.suspend(() =>
        state.answer === 'unreachable'
          ? Effect.fail(new DatabaseFailed({ detail: 'The database cannot be reached' }))
          : Effect.succeed(state.answer),
      ),
    released: () => Effect.void,
  };
  const keeper = await keptLease({
    lease,
    clock: { now: () => state.now, sleep: (milliseconds) => Effect.sleep(milliseconds) },
    sweepEveryMs: 5,
    lastsMs: 15,
    held: (before) =>
      Effect.sync(() => {
        said.push(`held after ${before}`);
      }),
    standingBy: ({ holder }, before) =>
      Effect.sync(() => {
        said.push(`standing by for ${holder} after ${before}`);
      }),
    trouble: (what) =>
      Effect.sync(() => {
        said.push(what);
      }),
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
