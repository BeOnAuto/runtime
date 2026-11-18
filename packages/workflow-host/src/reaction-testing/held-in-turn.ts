import { streamSignalOf } from '@on.auto/ledger';
import { Effect, Function } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { FollowedOrgs } from '../follower/followed-orgs.ts';
import type { FollowerWork } from '../follower/follower-wake-up.ts';
import { followedOrgsKnowingHolds, heldTriesOn } from '../holds/known-holds.ts';
import type { HoldNotes } from '../holds/playbook-holds.ts';
import { failedRoundsOn } from '../loop/failed-rounds.ts';
import { skippingClock } from '../loop/host-clock.ts';
import { openedOn, type SettingsOf } from '../testing/host-files.ts';

export const failingFirst = Array.from(
  { length: 64 },
  (_, index) => `playbook/acme/first-${String(index).padStart(2, '0')}/`,
);

export const dueAfterThem = 'playbook/acme/after/';

interface InTurn {
  readonly work: FollowerWork;
  readonly passed: readonly string[];
  readonly failedTries: readonly string[];
}

function workInTurnOn(database: HostDatabase, orgs: FollowedOrgs, dueBy: number): InTurn {
  const passed: string[] = [];
  const failedTries: string[] = [];
  const quietly = Function.constant(Effect.void);
  const holdNotes: HoldNotes = {
    tried: quietly,
    failed: (playbookKey) =>
      Effect.sync(() => {
        failedTries.push(playbookKey);
      }),
    lifted: quietly,
  };
  const work: FollowerWork = {
    passes: {
      org: Function.constant(Effect.succeed('caught_up')),
      held: ({ playbookKey }) =>
        failingFirst.includes(playbookKey)
          ? Effect.die(new Error('The test failed this pass'))
          : Effect.as(
              Effect.andThen(
                orgs.lifted(playbookKey),
                Effect.sync(() => {
                  passed.push(playbookKey);
                }),
              ),
              'caught_up',
            ),
    },
    discovery: { atStart: quietly, orgSeen: quietly },
    sweeps: {
      started: quietly,
      next: Function.constant(Effect.succeed({ orgs: [], again: false })),
      passAgain: Function.constVoid,
    },
    upkeep: {
      sweep: quietly,
      fireSchedules: quietly,
      nextScheduleAt: Function.constant(Effect.succeed(null)),
      nextDeferredAt: Function.constant(Effect.succeed(null)),
    },
    appended: streamSignalOf(),
    holds: heldTriesOn(orgs, holdNotes),
    rounds: failedRoundsOn(database, 'follower'),
    clock: skippingClock(dueBy),
    sweepEveryMs: 1000,
    trouble: quietly,
  };
  return { work, passed, failedTries };
}

export async function heldInTurnOn(settingsOf: SettingsOf, dueBy: number): Promise<InTurn> {
  const database = await openedOn(await settingsOf());
  const orgs = followedOrgsKnowingHolds(database);
  await Effect.runPromise(
    Effect.forEach(
      [...failingFirst, dueAfterThem],
      (playbookKey, index) =>
        orgs.parked({
          playbookKey,
          org: 'acme',
          progress: { cursor: 'c-0', delivered: null, attempts: 0, waiting: false },
          hold: { heldFor: 'content', since: dueBy - 60_000, until: dueBy - 100 + index, holds: 1 },
        }),
      { discard: true },
    ),
  );
  return workInTurnOn(database, orgs, dueBy);
}
