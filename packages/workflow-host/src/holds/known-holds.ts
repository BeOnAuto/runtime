import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { followedPlaybooksOn, type FollowedPlaybooks, type HeldPlaybooks } from '../follower/followed-playbooks.ts';
import { holdTryFailed, type HeldTries, type HoldNotes } from './playbook-holds.ts';

const noneHeld: HeldPlaybooks = { due: [], nextAt: null };

export function holdsKnownIn(playbooks: FollowedPlaybooks): FollowedPlaybooks {
  const known = { mayHold: true };
  return {
    ...playbooks,
    held: (playbookKey, hold) =>
      Effect.andThen(
        Effect.sync(() => {
          known.mayHold = true;
        }),
        playbooks.held(playbookKey, hold),
      ),
    heldAt: (now, limit) =>
      Effect.suspend(() =>
        known.mayHold
          ? Effect.tap(playbooks.heldAt(now, limit), ({ due, nextAt }) =>
              Effect.sync(() => {
                known.mayHold = due.length > 0 || nextAt !== null;
              }),
            )
          : Effect.succeed(noneHeld),
      ),
  };
}

export function followedPlaybooksKnowingHolds(database: HostDatabase): FollowedPlaybooks {
  return holdsKnownIn(followedPlaybooksOn(database));
}

export function heldTriesOn(playbooks: FollowedPlaybooks, holdNotes: HoldNotes): HeldTries {
  return {
    heldAt: playbooks.heldAt,
    failed: (held, failed) => holdTryFailed({ playbooks, holdNotes }, held, failed),
  };
}
