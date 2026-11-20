import type { HeldAssignments } from '@on.auto/access-control';
import { Caller, OrgContext } from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import { addressesOf, endedAmong, type MembersKept } from './members-read.ts';

const addressesNotForgottenMessage =
  'The addresses of invitations that ended could not be forgotten now; the next change of the members forgets them';

export const writtenNow = Effect.gen(function* () {
  const { id } = yield* Caller;
  const { org } = yield* OrgContext;
  return { org, by: id, at: DateTime.formatIso(yield* DateTime.now) };
});

export function forgottenOnceEnded(kept: MembersKept, org: string, state: HeldAssignments, at: string) {
  return Effect.gen(function* () {
    const ended = endedAmong(state, yield* addressesOf(kept), at);
    yield* Effect.promise(() => kept.invitations.forgotten(ended));
  }).pipe(
    Effect.catchCause(() =>
      Effect.logError(addressesNotForgottenMessage).pipe(Effect.annotateLogs({ operation: 'members', org })),
    ),
  );
}
