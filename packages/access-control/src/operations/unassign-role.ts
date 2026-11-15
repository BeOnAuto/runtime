import { Caller, OrgContext, OrgWriter, defineHttpOperation } from '@on.auto/operations';
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

const UnassignRoleInputSchema = Schema.Struct({ person: PersonField, role: RoleField });

const unassigned = Effect.fnUntraced(function* ({ person, role }: typeof UnassignRoleInputSchema.Type) {
  const caller = yield* Caller;
  const { org } = yield* OrgContext;
  const actor = yield* actorInStudio(caller);
  const principal = personNamed(person);
  const scope = theOrg(org);
  const { state } = yield* (yield* OrgWriter).execute(roleAssignmentsStreamOf(scope), roleAssignmentDecider, {
    kind: 'unassign',
    actor,
    principal,
    role: builtIn(role),
    scope,
    at: DateTime.formatIso(yield* DateTime.now),
    by: caller.id,
  });
  return heldRolesOf(state, principal, scope);
});

export const unassignRole = defineHttpOperation('org', 'command', {
  name: 'unassign_role',
  title: 'Unassign role',
  description: [
    'Takes a role in the org away from a person, and answers the roles they hold after it, none where it was their one role.',
    'A person signed in to Studio whose role lets them give roles takes it away, never a role beyond their own, and never the org’s last admin.',
  ].join(' '),
  route: { method: 'DELETE', path: '/role-assignments/{person}/{role}' },
  body: { kind: 'none' },
  permittedBy: ['org:write'],
  permissionsManagement: true,
  inputSchema: UnassignRoleInputSchema,
  outputSchema: HeldRolesSchema,
  reasons: ['forbidden', 'conflict'],
  handle: unassigned,
});
