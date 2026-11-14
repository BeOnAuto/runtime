import {
  Caller,
  NotFound,
  OrgContext,
  OrgWriter,
  defineHttpOperation,
  personOfTheOrg,
  signedInPersonPrefix,
} from '@on.auto/operations';
import { DateTime, Effect, Schema } from 'effect';

import { roleAssignmentDecider } from '../assignments/role-assignment-decider.ts';
import { roleAssignmentsStreamOf } from '../assignments/role-assignment-facts.ts';
import {
  HeldRolesSchema,
  PersonField,
  RoleField,
  actorInStudio,
  builtIn,
  heldRolesOf,
  personNamed,
  theOrg,
} from './role-assignment-shapes.ts';

const AssignRoleInputSchema = Schema.Struct({ person: PersonField, role: RoleField });

export const notAPersonOfTheOrg = 'The org holds no such person';

const assigned = Effect.fnUntraced(function* ({ person, role }: typeof AssignRoleInputSchema.Type) {
  const caller = yield* Caller;
  const { org } = yield* OrgContext;
  const actor = yield* actorInStudio(caller);
  if ((yield* personOfTheOrg(org, `${signedInPersonPrefix}${person}`)) === undefined) {
    return yield* Effect.fail(new NotFound({ detail: notAPersonOfTheOrg }));
  }
  const principal = personNamed(person);
  const scope = theOrg(org);
  const { state } = yield* (yield* OrgWriter).execute(roleAssignmentsStreamOf(scope), roleAssignmentDecider, {
    kind: 'assign',
    actor,
    principal,
    role: builtIn(role),
    scope,
    at: DateTime.formatIso(yield* DateTime.now),
    by: caller.id,
  });
  return heldRolesOf(state, principal, scope);
});

export const assignRole = defineHttpOperation('org', 'command', {
  name: 'assign_role',
  title: 'Assign role',
  description: [
    'Gives a person of the org a role, admin, editor or viewer, in place of the role they held, and answers the roles they hold after it.',
    'A person signed in to Studio whose role lets them give roles gives it, never a role beyond their own, and never leaving the org without an admin.',
  ].join(' '),
  route: { method: 'PUT', path: '/role-assignments/{person}/{role}' },
  body: { kind: 'none' },
  permittedBy: ['org:write'],
  inputSchema: AssignRoleInputSchema,
  outputSchema: HeldRolesSchema,
  reasons: ['forbidden', 'not_found', 'conflict'],
  handle: assigned,
});
