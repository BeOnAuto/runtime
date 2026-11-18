import { HashMap, Option } from 'effect';

import { builtInRoleIds, type BuiltInRoleId, type RoleTable } from '../roles/built-in-roles.ts';
import {
  principalKeyOf,
  type AssignedPrincipal,
  type AssignedRole,
  type AssignmentScope,
  type AssignmentSource,
  type RoleAssignmentEvent,
} from './role-assignment-facts.ts';

export interface HeldAssignment {
  readonly principal: AssignedPrincipal;
  readonly role: AssignedRole;
}

interface HeldBy {
  readonly principal: AssignedPrincipal;
  readonly roles: readonly AssignedRole[];
}

export interface HeldAssignments {
  readonly byPrincipal: HashMap.HashMap<string, HeldBy>;
  readonly holders: Readonly<Record<BuiltInRoleId, number>>;
  readonly lastEndedBy: HashMap.HashMap<string, AssignmentSource>;
}

export const noneHeld: HeldAssignments = {
  byPrincipal: HashMap.empty(),
  holders: { admin: 0, editor: 0, viewer: 0 },
  lastEndedBy: HashMap.empty(),
};

interface Named {
  readonly type: string;
  readonly id: string;
}

export function rolesHeldBy(state: HeldAssignments, principal: Named): readonly AssignedRole[] {
  return Option.match(HashMap.get(state.byPrincipal, principalKeyOf(principal)), {
    onNone: () => [],
    onSome: ({ roles }) => roles,
  });
}

export function heldAssignmentsIn(state: HeldAssignments): readonly HeldAssignment[] {
  return [...HashMap.values(state.byPrincipal)].flatMap(({ principal, roles }) =>
    roles.map((role) => ({ principal, role })),
  );
}

interface Changed {
  readonly key: string;
  readonly held: readonly AssignedRole[];
  readonly roles: readonly AssignedRole[];
  readonly source: AssignmentSource;
}

function lastEndedAfter({ lastEndedBy }: HeldAssignments, { key, held, roles, source }: Changed) {
  if (roles.length > 0) {
    return HashMap.remove(lastEndedBy, key);
  }
  return held.length > 0 ? HashMap.set(lastEndedBy, key, source) : lastEndedBy;
}

export function evolvedBy(state: HeldAssignments, { type, data }: RoleAssignmentEvent): HeldAssignments {
  const key = principalKeyOf(data.principal);
  const held = rolesHeldBy(state, data.principal);
  const others = held.filter(({ id }) => id !== data.role.id);
  const roles = type === 'role_assigned' ? [...others, data.role] : others;
  return {
    byPrincipal:
      roles.length === 0
        ? HashMap.remove(state.byPrincipal, key)
        : HashMap.set(state.byPrincipal, key, { principal: data.principal, roles }),
    holders: { ...state.holders, [data.role.id]: state.holders[data.role.id] + roles.length - held.length },
    lastEndedBy: lastEndedAfter(state, { key, held, roles, source: data.source }),
  };
}

export function assignedOf(
  { principal, role }: HeldAssignment,
  scope: AssignmentScope,
  source: AssignmentSource,
): RoleAssignmentEvent {
  return { type: 'role_assigned', data: { principal, role, scope, source } };
}

export function unassignedOf(
  { principal, role }: HeldAssignment,
  scope: AssignmentScope,
  source: AssignmentSource,
): RoleAssignmentEvent {
  return { type: 'role_unassigned', data: { principal, role, scope, source } };
}

export function holdsAnAssigner(table: RoleTable, { holders }: HeldAssignments): boolean {
  return builtInRoleIds.some((id) => table[id].assignsRoles && holders[id] > 0);
}
