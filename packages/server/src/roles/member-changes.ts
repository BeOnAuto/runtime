import type { HeldAssignments } from '@on.auto/access-control';
import {
  Caller,
  Forbidden,
  OrgContext,
  roleRefusalDetail,
  roleRefusalKind,
  signedInPersonPrefix,
  tokenTypeRefusalDetail,
  type CallerIdentity,
  type PrincipalReference,
} from '@on.auto/operations';
import { DateTime, Effect, Schema } from 'effect';

import { addressesOf, endedAmong, type MembersKept } from './members-read.ts';

const addressesNotForgottenMessage =
  'The addresses of invitations that ended could not be forgotten now; the next change of the members forgets them';

export const NothingAsked = Schema.Record(Schema.String, Schema.Never);

export const writtenNow = Effect.gen(function* () {
  const { id } = yield* Caller;
  const { org } = yield* OrgContext;
  return { org, by: id, at: DateTime.formatIso(yield* DateTime.now) };
});

export function actorOf({ id, client }: CallerIdentity): Effect.Effect<PrincipalReference, Forbidden> {
  return id.startsWith(signedInPersonPrefix) && client === undefined
    ? Effect.succeed({ type: 'person', id: id.slice(signedInPersonPrefix.length) })
    : Effect.fail(new Forbidden({ detail: tokenTypeRefusalDetail, kind: 'not_allowed_token_type' }));
}

export function inApprovedWords<E>(refusal: E): E | Forbidden {
  return refusal instanceof Forbidden ? new Forbidden({ detail: roleRefusalDetail, kind: roleRefusalKind }) : refusal;
}

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
