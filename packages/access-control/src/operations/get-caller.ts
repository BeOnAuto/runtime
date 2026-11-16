import {
  Caller,
  PermissionSchema,
  allPermissions,
  defineHttpOperation,
  signedInPersonPrefix,
  type CallerIdentity,
  type Permission,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { builtInRoleIds, builtInRoles, type BuiltInRoleId } from '../roles/built-in-roles.ts';
import { CallerRoles } from '../roles/caller-roles.ts';
import type { RoleAssignment, RoleAssignments } from '../roles/role-assignments.ts';

const NothingAsked = Schema.Record(Schema.String, Schema.Never);

const CallerAnsweredSchema = Schema.Struct({
  permissions: Schema.Array(PermissionSchema).annotate({
    description:
      'The permissions the caller may use in the org, of org:read, org:write, playbook:read and playbook:write',
  }),
});

function isABuiltInRole(id: string): id is BuiltInRoleId {
  return builtInRoleIds.some((role) => role === id);
}

function permittedByTheRolesOf(held: readonly RoleAssignment[], org: string): ReadonlySet<Permission> {
  return new Set(
    held
      .filter(({ scope }) => scope.type === 'org' && scope.id === org)
      .map(({ role }) => role.id)
      .filter((id) => isABuiltInRole(id))
      .flatMap((id) => builtInRoles[id].permits),
  );
}

function permissionsWithin(
  caller: CallerIdentity,
  permitted: (permission: Permission) => boolean,
): readonly Permission[] {
  return allPermissions.filter((permission) => caller.permissions.includes(permission) && permitted(permission));
}

function permissionsOf(caller: CallerIdentity, roles: RoleAssignments | null) {
  if (roles === null || !caller.id.startsWith(signedInPersonPrefix)) {
    return Effect.succeed(permissionsWithin(caller, () => true));
  }
  const person = caller.id.slice(signedInPersonPrefix.length);
  return Effect.map(roles.heldBy({ type: 'person', id: person }, caller.org), (held) => {
    const permitted = permittedByTheRolesOf(held, caller.org);
    return permissionsWithin(caller, (permission) => permitted.has(permission));
  });
}

export const getCaller = defineHttpOperation('org', 'query', {
  name: 'get_caller',
  title: 'Get caller',
  description:
    'Answers the permissions the caller may use in the org: those their credential holds that their role in the org permits.',
  route: { method: 'GET', path: '/caller' },
  body: { kind: 'none' },
  permittedBy: ['org:read', 'playbook:read'],
  inputSchema: NothingAsked,
  outputSchema: CallerAnsweredSchema,
  reasons: [],
  handle: () =>
    Effect.gen(function* () {
      const caller = yield* Caller;
      const permissions = yield* CallerRoles.use((roles) => permissionsOf(caller, roles));
      return { permissions };
    }),
});
