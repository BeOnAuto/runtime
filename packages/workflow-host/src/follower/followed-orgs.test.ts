import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { onSQLite, openedOn } from '../testing/host-files.ts';
import { followedOrgsOn, isDueAt, mostWaitOf, type FollowedOrgs, type Hold, type Progress } from './followed-orgs.ts';

const now = Date.parse('2026-11-11T09:00:00.000Z');

const aMinute = 60_000;

const [alpha, beta, gamma] = ['playbook/acme/alpha/', 'playbook/acme/beta/', 'playbook/globex/gamma/'];

const dueHold: Hold = { heldFor: 'content', since: now - 60_000, until: now, holds: 7 };

const laterHold: Hold = { heldFor: 'unreadable', since: now - 1000, until: now + 5000, holds: 1 };

const atTheStart: Progress = { cursor: 'c-0', delivered: null, attempts: 0, waiting: false };

function parkedIn(playbooks: FollowedOrgs, playbookKey: string, org: string, hold: Hold) {
  return playbooks.parked({ playbookKey, org, progress: atTheStart, hold });
}

async function playbooksHolding(): Promise<FollowedOrgs> {
  const playbooks = followedOrgsOn(await openedOn(await onSQLite()));
  await Effect.runPromise(
    Effect.forEach(['acme', 'globex', 'initech'], (org) => playbooks.follow(org, `${org}-0`), { discard: true }),
  );
  await Effect.runPromise(
    Effect.andThen(parkedIn(playbooks, alpha, 'acme', laterHold), parkedIn(playbooks, beta, 'acme', dueHold)),
  );
  return playbooks;
}

describe('the place of a followed org', () => {
  it('is kept in its row from the first place it is given, which a second follow does not move, and read with it', async () => {
    const playbooks = await playbooksHolding();
    await Effect.runPromise(playbooks.follow('acme', 'acme-9'));
    await Effect.runPromise(
      playbooks.save('globex', { cursor: 'c-9', delivered: '["x","y"]', attempts: 2, waiting: true }),
    );

    const [acme, globex, unknown] = await Effect.runPromise(
      Effect.all([playbooks.load('acme'), playbooks.load('globex'), playbooks.load('umbrella')]),
    );

    expect([acme?.cursor, globex, unknown]).toEqual([
      'acme-0',
      { org: 'globex', cursor: 'c-9', delivered: '["x","y"]', attempts: 2, waiting: true },
      undefined,
    ]);
  });

  it('is read by a sweep that takes the orgs that wait, those taken longest ago first, and that goes round the orgs in order', async () => {
    const playbooks = await playbooksHolding();
    const waiting: Progress = { cursor: null, delivered: null, attempts: 0, waiting: true };
    await Effect.runPromise(Effect.andThen(playbooks.save('initech', waiting), playbooks.save('acme', waiting)));

    const [first, second, round, afterAcme] = await Effect.runPromise(
      Effect.all([
        playbooks.waitingForASweep(1),
        playbooks.waitingForASweep(1),
        playbooks.following('', 8),
        playbooks.following('acme', 1),
      ]),
    );
    const none = await Effect.runPromise(
      Effect.andThen(
        Effect.forEach(['acme', 'initech'], (org) => playbooks.save(org, atTheStart), { discard: true }),
        playbooks.waitingForASweep(8),
      ),
    );

    expect([first.map(({ org }) => org), second.map(({ org }) => org)]).toEqual([['acme'], ['initech']]);
    expect([round.map(({ org }) => org), afterAcme.map(({ org }) => org), none]).toEqual([
      ['acme', 'globex', 'initech'],
      ['globex'],
      [],
    ]);
  });
});

describe('a playbook parked in its org', () => {
  it('is kept in a row of its own with its place and its hold, named among the playbooks held in its org alone, and goes when lifted', async () => {
    const playbooks = await playbooksHolding();
    await Effect.runPromise(parkedIn(playbooks, gamma, 'globex', dueHold));
    const moved: Progress = { cursor: 'c-4', delivered: '["a","b"]', attempts: 3, waiting: false };
    await Effect.runPromise(playbooks.parked({ playbookKey: alpha, org: 'acme', progress: moved, hold: dueHold }));

    const [acme, globex, due] = await Effect.runPromise(
      Effect.all([playbooks.heldIn('acme'), playbooks.heldIn('globex'), playbooks.heldAt(now, 8)]),
    );
    await Effect.runPromise(playbooks.lifted(alpha));
    const lifted = await Effect.runPromise(playbooks.heldIn('acme'));

    expect([[...acme], [...globex], [...lifted]]).toEqual([[alpha, beta], [gamma], [beta]]);
    expect(due.due.find(({ playbookKey }) => playbookKey === alpha)).toEqual({
      playbookKey: alpha,
      org: 'acme',
      progress: { ...moved, waiting: false },
      hold: dueHold,
    });
  });
});

describe('the held playbooks at a moment', () => {
  it('are those whose time has come, with the time of the next one held', async () => {
    const playbooks = await playbooksHolding();

    const held = await Effect.runPromise(playbooks.heldAt(now, 8));

    expect([held.due.map(({ playbookKey }) => playbookKey), held.nextAt]).toEqual([[beta], now + 5000]);
  });

  it('count as due a hold whose time is further away than its reason ever waits, as after a clock that went back, with the time of the next one not due', async () => {
    const playbooks = await playbooksHolding();
    const wentBack = now - 3_600_000;
    await Effect.runPromise(playbooks.held(beta, { ...dueHold, until: wentBack + 40_000 }));

    const held = await Effect.runPromise(playbooks.heldAt(wentBack, 8));

    expect([held.due.map(({ playbookKey }) => playbookKey), held.nextAt]).toEqual([[alpha], wentBack + 40_000]);
  });

  it('are read with a reason a later release wrote, which this release does not know, and are due at their time', async () => {
    const playbooks = await playbooksHolding();
    const later: Hold = { heldFor: 'a reason of a later release', since: now - 1000, until: now, holds: 2 };
    await Effect.runPromise(parkedIn(playbooks, gamma, 'globex', dueHold));
    await Effect.runPromise(playbooks.held(gamma, later));

    const held = await Effect.runPromise(playbooks.heldAt(now, 8));

    expect(held.due.map(({ hold }) => hold)).toEqual([dueHold, later]);
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

describe('the longest a hold waits between two tries', () => {
  it('is a minute for content, five minutes for a record this release cannot read, and the longest of them for a reason it does not know', () => {
    expect([mostWaitOf('content'), mostWaitOf('unreadable'), mostWaitOf('a reason of a later release')]).toEqual([
      aMinute,
      5 * aMinute,
      5 * aMinute,
    ]);
  });
});

describe('the time of a hold, at a moment', () => {
  it('is due from its time on, and not before it', () => {
    const hold = { heldFor: 'content', until: now };

    expect([isDueAt(hold, now - 1), isDueAt(hold, now), isDueAt(hold, now + 1)]).toEqual([false, true, true]);
  });

  it('is due at once when its time is further away than its reason ever waits, as after a clock that went back', () => {
    const waits = [
      isDueAt({ heldFor: 'content', until: now + aMinute }, now),
      isDueAt({ heldFor: 'content', until: now + aMinute + 1 }, now),
      isDueAt({ heldFor: 'unreadable', until: now + 5 * aMinute }, now),
      isDueAt({ heldFor: 'unreadable', until: now + 5 * aMinute + 1 }, now),
      isDueAt({ heldFor: 'a reason of a later release', until: now + 5 * aMinute }, now),
      isDueAt({ heldFor: 'a reason of a later release', until: now + 60 * aMinute }, now),
    ];

    expect(waits).toEqual([false, true, false, true, false, true]);
  });
});

function parkedAt(until: number): Hold {
  return { heldFor: 'delivery', since: until, until, holds: 1 };
}

describe('a playbook parked for a delivery that waits to be tried again', () => {
  it('is read by the sweeps, those parked longest ago first, and never as a hold due by the clock', async () => {
    const playbooks = await playbooksHolding();
    await Effect.runPromise(
      Effect.andThen(
        parkedIn(playbooks, gamma, 'globex', parkedAt(now + 2)),
        parkedIn(playbooks, 'playbook/acme/delta/', 'acme', parkedAt(now + 1)),
      ),
    );

    const [swept, byTheClock] = await Effect.runPromise(
      Effect.zip(playbooks.parkedForDelivery(8), playbooks.heldAt(Number.MAX_SAFE_INTEGER, 8)),
    );

    expect(swept.map(({ playbookKey }) => playbookKey)).toEqual(['playbook/acme/delta/', gamma]);
    expect(byTheClock.due.map(({ playbookKey }) => playbookKey)).toEqual([beta, alpha]);
  });
});
