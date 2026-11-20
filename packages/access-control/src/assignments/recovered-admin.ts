import { OrgWriter } from '@on.auto/operations';
import { Effect } from 'effect';

import { personNamed, theOrg } from '../operations/role-assignment-shapes.ts';
import { roleAssignmentDecider } from './role-assignment-decider.ts';
import { roleAssignmentsStreamOf } from './role-assignment-facts.ts';
import { recoveredAs } from './sign-in-decisions.ts';

interface RecoveredWhen {
  readonly at: string;
  readonly by: string;
}

export const adminRecovered = Effect.fnUntraced(function* (org: string, person: string, { at, by }: RecoveredWhen) {
  const scope = theOrg(org);
  const principal = personNamed(person);
  const { decidedOn } = yield* (yield* OrgWriter).execute(roleAssignmentsStreamOf(scope), roleAssignmentDecider, {
    kind: 'recover',
    principal,
    scope,
    at,
    by,
  });
  return recoveredAs(decidedOn, principal);
});
