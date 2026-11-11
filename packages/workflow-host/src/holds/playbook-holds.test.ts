import { PayloadsOutside } from '@on.auto/operations/payloads';
import { Context, Effect, Random } from 'effect';
import { describe, expect, it } from 'vitest';

import type { FollowedPlaybook, Hold } from '../follower/followed-playbooks.ts';
import {
  holdAfter,
  holdsUnreadableIn,
  isHeldAt,
  type HeldAtARecord,
  type HoldLifted,
  type HoldParts,
  type HoldTried,
  type PassReached,
} from './playbook-holds.ts';

const now = Date.parse('2026-11-11T09:00:00.000Z');

const record = { id: 'r-1', type: 'run_succeeded' };

const followed: FollowedPlaybook = {
  playbookKey: 'playbook/acme/alpha/',
  cursor: 'c-1',
  delivered: null,
  attempts: 0,
  waiting: true,
  hold: undefined,
};

const heldAtTheRecord: HeldAtARecord = { heldFor: 'content', record, lag: { records: 4, capped: false } };

const heldReach: PassReached = { end: 'waiting', records: 0, held: heldAtTheRecord };

function factorOf(factor: number): Random.Random {
  return { nextIntUnsafe: () => 0, nextDoubleUnsafe: () => factor };
}

interface Kept {
  readonly holds: (Hold | 'lifted')[];
  readonly tried: HoldTried[];
  readonly lifted: HoldLifted[];
}

function partsKeeping(): { readonly parts: HoldParts; readonly kept: Kept } {
  const kept: Kept = { holds: [], tried: [], lifted: [] };
  return {
    kept,
    parts: {
      now: () => now,
      playbooks: {
        held: (_playbookKey, hold) =>
          Effect.sync(() => {
            kept.holds.push(hold);
          }),
        lifted: () =>
          Effect.sync(() => {
            kept.holds.push('lifted');
          }),
      },
      holdNotes: {
        tried: (_playbookKey, tried) =>
          Effect.sync(() => {
            kept.tried.push(tried);
          }),
        failed: () => Effect.void,
        lifted: (_playbookKey, lifted) =>
          Effect.sync(() => {
            kept.lifted.push(lifted);
          }),
      },
    },
  };
}

function keptAfter(playbook: FollowedPlaybook, reached: PassReached, factor = 0): Kept {
  const { parts, kept } = partsKeeping();
  Effect.runSync(holdAfter(parts, playbook, reached).pipe(Effect.provideService(Random.Random, factorOf(factor))));
  return kept;
}

function waitsOf(holds: readonly (Hold | 'lifted')[]): readonly number[] {
  return holds.flatMap((hold) => (hold === 'lifted' ? [] : [hold.until - now]));
}

function heldADayFor(heldFor: Hold['heldFor']): FollowedPlaybook {
  return { ...followed, hold: { heldFor, since: now - 86_400_000, until: now, holds: 20 } };
}

describe('the hold a pass leaves on a playbook', () => {
  it('begins at a pass that ended held, tried again between half and all of a second later, its first try said', () => {
    const kept = keptAfter(followed, heldReach, 0.5);

    const hold: Hold = { heldFor: 'content', since: now, until: now + 750, holds: 1 };
    expect(kept).toEqual({
      holds: [hold],
      tried: [{ hold, first: true, record, lag: { records: 4, capped: false }, at: now }],
      lifted: [],
    });
  });

  it('goes on from the hold it had, keeping when it began, twice as long a wait after each try, at most a minute', () => {
    const since = now - 600_000;
    const before: Hold = { heldFor: 'content', since, until: now, holds: 9 };

    const [shortest, longest] = [0, 1].map((factor) => keptAfter({ ...followed, hold: before }, heldReach, factor));

    expect([shortest?.holds, longest?.holds]).toEqual([
      [{ heldFor: 'content', since, until: now + 30_000, holds: 10 }],
      [{ heldFor: 'content', since, until: now + 60_000, holds: 10 }],
    ]);
    expect(shortest?.tried.map(({ first }) => first)).toEqual([false]);
  });

  it('keeps the time of the next try in whole milliseconds, never before the wait of the gate', () => {
    const kept = keptAfter(followed, heldReach, 0.123);

    expect(kept.holds).toEqual([{ heldFor: 'content', since: now, until: now + 562, holds: 1 }]);
  });
});

describe('the hold of a playbook held again for another reason or at another record', () => {
  const before: Hold = { heldFor: 'content', since: now - 5000, until: now, holds: 3 };

  it('starts its tries again, the first of its reason, when the reason changed, keeping when the playbook’s hold began', () => {
    const unreadable: PassReached = { ...heldReach, held: { ...heldAtTheRecord, heldFor: 'unreadable' } };

    const kept = keptAfter({ ...followed, hold: before }, unreadable, 1);

    expect(kept.tried).toMatchObject([
      { first: true, hold: { heldFor: 'unreadable', since: now - 5000, holds: 1, until: now + 1000 } },
    ]);
  });

  it('starts its tries again when the pass moved past records before it was held, keeping when the playbook’s hold began', () => {
    const kept = keptAfter({ ...followed, hold: before }, { ...heldReach, records: 3 }, 1);

    expect(kept.tried).toMatchObject([
      { first: true, hold: { heldFor: 'content', since: now - 5000, holds: 1, until: now + 1000 } },
    ]);
  });

  it('waits at most five minutes between the tries of a record this release cannot read, and a minute for content', () => {
    const unreadable: PassReached = { ...heldReach, held: { ...heldAtTheRecord, heldFor: 'unreadable' } };
    const waits = [
      waitsOf(keptAfter(heldADayFor('unreadable'), unreadable, 0).holds),
      waitsOf(keptAfter(heldADayFor('unreadable'), unreadable, 1).holds),
      waitsOf(keptAfter(heldADayFor('content'), heldReach, 1).holds),
    ];

    expect(waits).toEqual([[150_000], [300_000], [60_000]]);
  });
});

describe('the hold of a pass that did not end held', () => {
  it('is lifted by a pass that did not end held, said with how long it lasted and the records the pass moved past', () => {
    const before: Hold = { heldFor: 'content', since: now - 5000, until: now, holds: 3 };

    const kept = keptAfter({ ...followed, hold: before }, { end: 'more', records: 1000 });

    expect(kept).toEqual({
      holds: ['lifted'],
      tried: [],
      lifted: [{ hold: before, at: now, records: 1000, more: true }],
    });
  });

  it('is neither kept nor lifted by a pass of a playbook not held that did not end held', () => {
    expect(keptAfter(followed, { end: 'caught_up', records: 3 })).toEqual({ holds: [], tried: [], lifted: [] });
  });
});

describe('a hold, at a moment', () => {
  it('holds until its time, and not from its time on, and no hold holds', () => {
    const hold: Hold = { heldFor: 'content', since: now - 1000, until: now, holds: 1 };

    expect([isHeldAt({ hold }, now - 1), isHeldAt({ hold }, now), isHeldAt(followed, now)]).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe('a fact the follower cannot read', () => {
  it('holds the playbook where payloads are kept outside, and nowhere else', () => {
    expect([
      holdsUnreadableIn({ context: Context.make(PayloadsOutside, true) }),
      holdsUnreadableIn({ context: Context.make(PayloadsOutside, false) }),
      holdsUnreadableIn({}),
    ]).toEqual([true, false, false]);
  });
});
