import type { ApprovalRecordSchema } from '@on.auto/definitions';
import { Forbidden, type CallerIdentity } from '@on.auto/operations';
import { Effect, Predicate, type Schema } from 'effect';

export interface ApprovalAsked {
  readonly approval: typeof ApprovalRecordSchema.Type;
  readonly person: string;
}

export function approvedByThePerson(
  { approval, person }: ApprovalAsked,
  caller: Pick<CallerIdentity, 'id'>,
): Effect.Effect<void, Forbidden> {
  return caller.id === person
    ? Effect.void
    : Effect.fail(
        new Forbidden({
          detail: `This request asks ${person} to approve an action of ${approval.server}, and an approval request is answered by the person it asks alone`,
        }),
      );
}

function saysApproved(answer: Schema.Json): boolean {
  return Predicate.hasProperty(answer, 'approved') && answer.approved === true;
}

export function approvedFromTheirSession(
  caller: Pick<CallerIdentity, 'client'>,
  answer: Schema.Json,
): Effect.Effect<void, Forbidden> {
  return caller.client === undefined || !saysApproved(answer)
    ? Effect.void
    : Effect.fail(
        new Forbidden({
          detail:
            'The person approves an action from their own session, in Studio, and never through an agent, since an approval is what keeps instructions hidden in a page from acting; an agent may answer approved false, with a reason, when the person declines',
        }),
      );
}
