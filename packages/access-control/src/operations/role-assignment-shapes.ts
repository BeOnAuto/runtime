import {
  ContextReference,
  Forbidden,
  signedInPersonPrefix,
  type CallerIdentity,
  type PrincipalReference,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { rolesHeldBy, type HeldAssignments } from '../assignments/role-assignment-decider.ts';
import {
  AssignmentSourceSchema,
  type AssignedPrincipal,
  type AssignedRole,
  type AssignmentScope,
} from '../assignments/role-assignment-facts.ts';
import { builtInRoleIds, type BuiltInRoleId } from '../roles/built-in-roles.ts';

export const PersonField = ContextReference.check(Schema.isMinLength(1)).annotate({
  description: 'The person’s id, as their sign-in names them and list_role_assignments answers it',
});

export const RoleField = Schema.Literals(builtInRoleIds).annotate({
  description:
    'admin, who manages the members; editor, who builds, runs and changes playbooks; or viewer, who views and comments',
});

const PrincipalSchema = Schema.Struct({
  type: Schema.Literal('person').annotate({ description: 'person, a person signed in' }),
  id: Schema.String.annotate({ description: 'The person’s id, as their sign-in names them' }),
}).annotate({ description: 'Who holds the role' });

const RoleSchema = Schema.Struct({
  type: Schema.Literal('built_in').annotate({ description: 'built_in, a role every release of Auto ships' }),
  id: Schema.String.annotate({ description: 'admin, editor or viewer' }),
}).annotate({ description: 'The role' });

const ScopeSchema = Schema.Struct({
  type: Schema.Literals(['org', 'playbook']).annotate({ description: 'org, the whole org, or playbook, one playbook' }),
  id: Schema.String.annotate({ description: 'The id of the org or of the playbook' }),
}).annotate({ description: 'Where the role holds' });

export const HeldRolesSchema = Schema.Struct({
  principal: PrincipalSchema,
  scope: ScopeSchema,
  roles: Schema.Array(RoleSchema).annotate({ description: 'The roles the person holds there now, none or one' }),
});

export const ListedAssignmentSchema = Schema.Struct({
  principal: PrincipalSchema,
  role: RoleSchema,
  scope: ScopeSchema,
  source: AssignmentSourceSchema.annotate({
    description:
      'How it was given: manual, by a person; invitation; enrolment, by joining from a claimed domain; import, from the roles people held when roles were first kept; command, by the runtime’s command; or identity_service',
  }),
  assigned_at: Schema.String.annotate({ description: 'When it was given, in ISO 8601' }),
  assigned_by: Schema.String.annotate({ description: 'The id of the caller who gave it' }),
});

export const onlyInStudio = 'A role is given or taken away only by a person signed in to Studio';

export function actorInStudio({ id, client }: CallerIdentity): Effect.Effect<PrincipalReference, Forbidden> {
  return id.startsWith(signedInPersonPrefix) && client === undefined
    ? Effect.succeed({ type: 'person', id: id.slice(signedInPersonPrefix.length) })
    : Effect.fail(new Forbidden({ detail: onlyInStudio }));
}

export function personNamed(id: string): AssignedPrincipal {
  return { type: 'person', id };
}

export function builtIn(id: BuiltInRoleId): AssignedRole {
  return { type: 'built_in', id };
}

export function theOrg(id: string): AssignmentScope {
  return { type: 'org', id };
}

export function heldRolesOf(state: HeldAssignments, principal: AssignedPrincipal, scope: AssignmentScope) {
  return { principal, scope, roles: rolesHeldBy(state, principal) };
}
