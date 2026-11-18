import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { followedOrgsOn, type FollowedOrgs, type HeldPlaybooks } from '../follower/followed-orgs.ts';
import { holdTryFailed, type HeldTries, type HoldNotes } from './playbook-holds.ts';

const noneHeld: HeldPlaybooks = { due: [], nextAt: null };

export function holdsKnownIn(orgs: FollowedOrgs): FollowedOrgs {
  const known = { mayHold: true };
  return {
    ...orgs,
    parked: (parked) =>
      Effect.andThen(
        Effect.sync(() => {
          known.mayHold = true;
        }),
        orgs.parked(parked),
      ),
    heldAt: (now, limit) =>
      Effect.suspend(() =>
        known.mayHold
          ? Effect.tap(orgs.heldAt(now, limit), ({ due, nextAt }) =>
              Effect.sync(() => {
                known.mayHold = due.length > 0 || nextAt !== null;
              }),
            )
          : Effect.succeed(noneHeld),
      ),
  };
}

export function followedOrgsKnowingHolds(database: HostDatabase): FollowedOrgs {
  return holdsKnownIn(followedOrgsOn(database));
}

export function heldTriesOn(orgs: FollowedOrgs, holdNotes: HoldNotes): HeldTries {
  return {
    heldAt: orgs.heldAt,
    parkedForDelivery: orgs.parkedForDelivery,
    failed: (held, failed) => holdTryFailed({ orgs, holdNotes }, held, failed),
  };
}
