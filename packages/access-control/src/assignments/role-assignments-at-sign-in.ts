import { OrgWriter } from '@on.auto/operations';
import { Effect } from 'effect';

import { personNamed, theOrg } from '../operations/role-assignment-shapes.ts';
import { roleAssignmentDecider } from './role-assignment-decider.ts';
import { roleAssignmentsStreamOf } from './role-assignment-facts.ts';
import { enrolledAs } from './sign-in-decisions.ts';

interface EnrolledWhen {
  readonly at: string;
  readonly by: string;
  readonly invitation?: string | undefined;
}

export const enrolledAtSignIn = Effect.fnUntraced(function* (
  org: string,
  person: string,
  { at, by, invitation }: EnrolledWhen,
) {
  const scope = theOrg(org);
  const principal = personNamed(person);
  const { decidedOn } = yield* (yield* OrgWriter).execute(roleAssignmentsStreamOf(scope), roleAssignmentDecider, {
    kind: 'enrol',
    principal,
    scope,
    at,
    by,
    invitation,
  });
  return enrolledAs(decidedOn, principal, { invitation, at });
});
