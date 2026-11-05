import type { SignInRecord } from '@on.auto/definitions';
import { Forbidden, type CallerIdentity } from '@on.auto/operations';
import { Effect, Predicate, type Schema } from 'effect';

export interface SignInAsked {
  readonly signIn: SignInRecord;
  readonly person: string;
}

export function answeredByThePerson(
  { signIn, person }: SignInAsked,
  caller: Pick<CallerIdentity, 'id'>,
): Effect.Effect<void, Forbidden> {
  return caller.id === person
    ? Effect.void
    : Effect.fail(
        new Forbidden({
          detail: `This request asks ${person} to sign in to ${signIn.site}, and a sign-in request is answered by the person it asks alone`,
        }),
      );
}

function saysSignedIn(answer: Schema.Json): boolean {
  return Predicate.hasProperty(answer, 'signed_in') && answer.signed_in === true;
}

export function signedInFromTheirSession(
  caller: Pick<CallerIdentity, 'client'>,
  answer: Schema.Json,
): Effect.Effect<void, Forbidden> {
  return caller.client === undefined || !saysSignedIn(answer)
    ? Effect.void
    : Effect.fail(
        new Forbidden({
          detail:
            'The person signs in through the link the request gives, so signed_in true is taken from their own session and never through an agent; an agent may answer signed_in false, with a reason, when the person will not sign in',
        }),
      );
}
