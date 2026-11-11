import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { followedPlaybooksOn, type FollowedPlaybooks, type Hold } from '../follower/followed-playbooks.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';

const now = Date.parse('2026-11-11T09:00:00.000Z');

const [alpha, beta, gamma] = ['playbook/acme/alpha/', 'playbook/acme/beta/', 'playbook/acme/gamma/'];

const dueHold: Hold = { heldFor: 'content', since: now - 60_000, until: now, holds: 7 };

const laterHold: Hold = { heldFor: 'unreadable', since: now - 1000, until: now + 5000, holds: 1 };

async function playbooksHolding(): Promise<FollowedPlaybooks> {
  const playbooks = followedPlaybooksOn(await openedOn(await onSQLite()));
  await Effect.runPromise(
    Effect.forEach([alpha, beta, gamma], (playbookKey) => playbooks.follow(playbookKey, null), { discard: true }),
  );
  await Effect.runPromise(Effect.andThen(playbooks.held(alpha, laterHold), playbooks.held(beta, dueHold)));
  return playbooks;
}

describe('the hold of a followed playbook', () => {
  it('is kept in its row and read with it, and lifted from it', async () => {
    const playbooks = await playbooksHolding();
    await Effect.runPromise(playbooks.save(alpha, { cursor: 'c-9', delivered: null, attempts: 2, waiting: true }));

    const held = await Effect.runPromise(playbooks.load(alpha));
    await Effect.runPromise(playbooks.lifted(alpha));
    const lifted = await Effect.runPromise(playbooks.load(alpha));

    expect(held).toEqual({
      playbookKey: alpha,
      cursor: 'c-9',
      delivered: null,
      attempts: 2,
      waiting: true,
      hold: laterHold,
    });
    expect(lifted?.hold).toBeUndefined();
  });

  it('is read with every row a sweep takes or goes round', async () => {
    const playbooks = await playbooksHolding();
    await Effect.runPromise(playbooks.save(beta, { cursor: null, delivered: null, attempts: 0, waiting: true }));

    const [waiting, round] = await Effect.runPromise(
      Effect.zip(playbooks.waitingForASweep(8), playbooks.following('', 8)),
    );

    expect(waiting.map(({ playbookKey, hold }) => [playbookKey, hold])).toEqual([[beta, dueHold]]);
    expect(round.map(({ hold }) => hold)).toEqual([laterHold, dueHold, undefined]);
  });
});

describe('the held playbooks at a moment', () => {
  it('are those whose time has come, with the time of the next one held', async () => {
    const playbooks = await playbooksHolding();

    const held = await Effect.runPromise(playbooks.heldAt(now, 8));

    expect([held.due.map(({ playbookKey }) => playbookKey), held.nextAt]).toEqual([[beta], now + 5000]);
  });

  it('are as many as were asked for, with no time read past them, and none and no time when none is held', async () => {
    const playbooks = await playbooksHolding();

    const [crowded, after] = await Effect.runPromise(
      Effect.zip(playbooks.heldAt(now + 5000, 2), playbooks.heldAt(now, 1)),
    );
    await Effect.runPromise(Effect.andThen(playbooks.lifted(alpha), playbooks.lifted(beta)));
    const none = await Effect.runPromise(playbooks.heldAt(now, 8));

    expect([crowded.due.length, crowded.nextAt, after.due.length, after.nextAt]).toEqual([2, null, 1, null]);
    expect(none).toEqual({ due: [], nextAt: null });
  });
});
