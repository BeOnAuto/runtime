import { Conflict, Forbidden, type Decider, type PrincipalReference, type Rejection } from '@on.auto/operations';
import { HashMap, Option, Result } from 'effect';

import {
  builtInRoleIds,
  builtInRoles,
  mayAssign,
  type BuiltInRoleId,
  type RoleTable,
} from '../roles/built-in-roles.ts';
import {
  RoleAssignmentEventSchema,
  principalKeyOf,
  type AssignedPrincipal,
  type AssignedRole,
  type AssignmentScope,
  type AssignmentSource,
  type RecordedRoleAssignmentEvent,
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
}

const noneHeld: HeldAssignments = { byPrincipal: HashMap.empty(), holders: { admin: 0, editor: 0, viewer: 0 } };

interface Asked {
  readonly scope: AssignmentScope;
  readonly at: string;
  readonly by: string;
}

export interface RoleGiven extends Asked, HeldAssignment {
  readonly kind: 'assign';
  readonly actor: PrincipalReference;
}

export interface RoleTaken extends Asked, HeldAssignment {
  readonly kind: 'unassign';
  readonly actor: PrincipalReference;
}

interface RolesImported extends Asked {
  readonly kind: 'import';
  readonly assignments: readonly HeldAssignment[];
}

export type RoleAssignmentCommand = RoleGiven | RoleTaken | RolesImported;

type RoleAssignmentRefusal = 'forbidden' | 'conflict';

type Decision = Result.Result<readonly RoleAssignmentEvent[], Rejection<RoleAssignmentRefusal>>;

type RoleAssignmentDecider = Decider<
  HeldAssignments,
  RoleAssignmentCommand,
  RecordedRoleAssignmentEvent,
  RoleAssignmentRefusal
>;

export const noRoleThatAssigns = 'Your role in the org does not let you give or take away roles';

export function beyondYourRole(role: string): string {
  return `Your role in the org does not let you give or take away the role ${role}`;
}

export const lastAssigner =
  'This would leave the org without an admin, so it is not done: make someone else an admin first';

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

function evolvedBy(state: HeldAssignments, { type, data }: RoleAssignmentEvent): HeldAssignments {
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
  };
}

function assignedOf(
  { principal, role }: HeldAssignment,
  scope: AssignmentScope,
  source: AssignmentSource,
): RoleAssignmentEvent {
  return { type: 'role_assigned', data: { principal, role, scope, source } };
}

function unassignedOf(
  { principal, role }: HeldAssignment,
  scope: AssignmentScope,
  source: AssignmentSource,
): RoleAssignmentEvent {
  return { type: 'role_unassigned', data: { principal, role, scope, source } };
}

function actorRefusal(
  table: RoleTable,
  state: HeldAssignments,
  actor: PrincipalReference,
  changed: readonly AssignedRole[],
): Forbidden | undefined {
  const held = rolesHeldBy(state, actor);
  if (!held.some(({ id }) => table[id].assignsRoles)) {
    return new Forbidden({ detail: noRoleThatAssigns });
  }
  const beyond = changed.find((asked) => !held.some(({ id }) => mayAssign(table, id, asked.id)));
  return beyond === undefined ? undefined : new Forbidden({ detail: beyondYourRole(beyond.id) });
}

function holdsAnAssigner(table: RoleTable, { holders }: HeldAssignments): boolean {
  return builtInRoleIds.some((id) => table[id].assignsRoles && holders[id] > 0);
}

function keepingAnAssigner(table: RoleTable, state: HeldAssignments, events: readonly RoleAssignmentEvent[]): Decision {
  const after = events.reduce((folded, event) => evolvedBy(folded, event), state);
  return holdsAnAssigner(table, state) && !holdsAnAssigner(table, after)
    ? Result.fail(new Conflict({ detail: lastAssigner, kind: 'unworkable' }))
    : Result.succeed(events);
}

function decidedGiving(table: RoleTable, command: RoleGiven, state: HeldAssignments): Decision {
  const held = rolesHeldBy(state, command.principal);
  const replaced = held.filter(({ id }) => id !== command.role.id);
  const refusal = actorRefusal(table, state, command.actor, [command.role, ...replaced]);
  if (refusal !== undefined) {
    return Result.fail(refusal);
  }
  const alreadyHeld = held.length > replaced.length;
  return keepingAnAssigner(table, state, [
    ...replaced.map((role) => unassignedOf({ principal: command.principal, role }, command.scope, 'manual')),
    ...(alreadyHeld ? [] : [assignedOf(command, command.scope, 'manual')]),
  ]);
}

function decidedTaking(table: RoleTable, command: RoleTaken, state: HeldAssignments): Decision {
  const refusal = actorRefusal(table, state, command.actor, [command.role]);
  if (refusal !== undefined) {
    return Result.fail(refusal);
  }
  const held = rolesHeldBy(state, command.principal).some(({ id }) => id === command.role.id);
  return keepingAnAssigner(table, state, held ? [unassignedOf(command, command.scope, 'manual')] : []);
}

function decidedImport({ assignments, scope }: RolesImported, state: HeldAssignments): Decision {
  const firstAt = new Map<string, number>(
    assignments.map(({ principal }, at): readonly [string, number] => [principalKeyOf(principal), at]).toReversed(),
  );
  return Result.succeed(
    assignments
      .filter(
        ({ principal }, at) =>
          firstAt.get(principalKeyOf(principal)) === at && rolesHeldBy(state, principal).length === 0,
      )
      .map((each) => assignedOf(each, scope, 'import')),
  );
}

function decided(table: RoleTable, command: RoleAssignmentCommand, state: HeldAssignments): Decision {
  if (command.kind === 'assign') {
    return decidedGiving(table, command, state);
  }
  return command.kind === 'unassign' ? decidedTaking(table, command, state) : decidedImport(command, state);
}

export function roleAssignmentDeciderOver(table: RoleTable): RoleAssignmentDecider {
  return {
    initialState: noneHeld,
    evolve: evolvedBy,
    decide: (command, state) => decided(table, command, state),
    context: ({ at, by }) => ({ at, by }),
    eventSchema: RoleAssignmentEventSchema,
  };
}

export const roleAssignmentDecider = roleAssignmentDeciderOver(builtInRoles);
