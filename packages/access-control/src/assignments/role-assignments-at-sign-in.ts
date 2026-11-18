import { OrgWriter } from '@on.auto/operations';
import { Effect } from 'effect';

import { personNamed, theOrg } from '../operations/role-assignment-shapes.ts';
import { enrolledAs, roleAssignmentDecider } from './role-assignment-decider.ts';
import { roleAssignmentsStreamOf } from './role-assignment-facts.ts';

interface EnrolledWhen {
  readonly at: string;
  readonly by: string;
}

export const enrolledAtSignIn = Effect.fnUntraced(function* (org: string, person: string, { at, by }: EnrolledWhen) {
  const scope = theOrg(org);
  const principal = personNamed(person);
  const { decidedOn } = yield* (yield* OrgWriter).execute(roleAssignmentsStreamOf(scope), roleAssignmentDecider, {
    kind: 'enrol',
    principal,
    scope,
    at,
    by,
  });
  return enrolledAs(decidedOn, principal);
});
