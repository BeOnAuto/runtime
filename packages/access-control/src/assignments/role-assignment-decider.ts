import { Conflict, Forbidden, type Decider, type PrincipalReference } from '@on.auto/operations';
import { Result } from 'effect';

import {
  decidedOfInvitations,
  isOfInvitations,
  withTheirInvitationsRevoked,
} from '../invitations/invitation-decisions.ts';
import { decidedEnrolmentSetting, isEnrolmentSetting } from '../joining/joining-decisions.ts';
import {
  builtInRoles,
  builtInRolesAtSignIn,
  mayAssign,
  type RolesAtSignIn,
  type RoleTable,
} from '../roles/built-in-roles.ts';
import {
  assignedOf,
  evolvedBy,
  holdsAnAssigner,
  noneHeld,
  rolesHeldBy,
  unassignedOf,
  type HeldAssignment,
  type HeldAssignments,
} from './held-assignments.ts';
import type {
  Decision,
  DeprovisioningSource,
  RoleAssignmentCommand,
  RoleAssignmentRefusal,
  RoleGiven,
  RolesDeprovisioned,
  RolesProvisioned,
  RoleTaken,
} from './role-assignment-commands.ts';
import {
  RoleAssignmentEventSchema,
  principalKeyOf,
  type AssignedRole,
  type RecordedRoleAssignmentEvent,
  type RoleAssignmentEvent,
} from './role-assignment-facts.ts';
import { decidedEnrolment, decidedRecovery, type Deciding } from './sign-in-decisions.ts';

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

export const lastAssigner = 'An organization must have at least one admin. Make another member an admin first.';

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
  const given = keepingAnAssigner(table, state, [
    ...replaced.map((role) => unassignedOf({ principal: command.principal, role }, command.scope, 'manual')),
    ...(alreadyHeld ? [] : [assignedOf(command, command.scope, 'manual')]),
  ]);
  return Result.map(given, (events) => withTheirInvitationsRevoked({ ...command, state }, 'role_changed', events));
}

function decidedTaking(table: RoleTable, command: RoleTaken, state: HeldAssignments): Decision {
  const refusal = actorRefusal(table, state, command.actor, [command.role]);
  if (refusal !== undefined) {
    return Result.fail(refusal);
  }
  const held = rolesHeldBy(state, command.principal).some(({ id }) => id === command.role.id);
  return keepingAnAssigner(table, state, held ? [unassignedOf(command, command.scope, 'manual')] : []);
}

function firstOfEachPrincipal(assignments: readonly HeldAssignment[]): readonly HeldAssignment[] {
  const firstAt = new Map<string, number>(
    assignments.map(({ principal }, at): readonly [string, number] => [principalKeyOf(principal), at]).toReversed(),
  );
  return assignments.filter(({ principal }, at) => firstAt.get(principalKeyOf(principal)) === at);
}

interface Provisioning {
  readonly table: RoleTable;
  readonly command: RolesProvisioned;
  readonly state: HeldAssignments;
  readonly withoutAnAssigner: boolean;
}

function provisionedTo(
  { table, command: { scope, source }, state, withoutAnAssigner }: Provisioning,
  assignment: HeldAssignment,
): readonly RoleAssignmentEvent[] {
  const held = rolesHeldBy(state, assignment.principal);
  if (held.length === 0) {
    return [assignedOf(assignment, scope, source)];
  }
  return withoutAnAssigner && table[assignment.role.id].assignsRoles
    ? [
        ...held.map((role) => unassignedOf({ principal: assignment.principal, role }, scope, source)),
        assignedOf(assignment, scope, source),
      ]
    : [];
}

function decidedProvisioning(table: RoleTable, command: RolesProvisioned, state: HeldAssignments): Decision {
  const provisioning: Provisioning = { table, command, state, withoutAnAssigner: !holdsAnAssigner(table, state) };
  return Result.succeed(
    firstOfEachPrincipal(command.assignments).flatMap((assignment) => provisionedTo(provisioning, assignment)),
  );
}

const membershipEndedAlready: Readonly<Record<DeprovisioningSource, boolean>> = {
  manual: false,
  identity_service: true,
};

function decidedDeprovisioning(table: RoleTable, command: RolesDeprovisioned, state: HeldAssignments): Decision {
  const ended = rolesHeldBy(state, command.principal).map((role) =>
    unassignedOf({ principal: command.principal, role }, command.scope, command.source),
  );
  const decision = membershipEndedAlready[command.source]
    ? Result.succeed(ended)
    : keepingAnAssigner(table, state, ended);
  return Result.map(decision, (events) => withTheirInvitationsRevoked({ ...command, state }, 'member_removed', events));
}

function decided(deciding: Deciding, command: RoleAssignmentCommand, state: HeldAssignments): Decision {
  if (isOfInvitations(command)) {
    return decidedOfInvitations(deciding.table, command, state);
  }
  if (isEnrolmentSetting(command)) {
    return decidedEnrolmentSetting(deciding, command, state);
  }
  if (command.kind === 'recover') {
    return decidedRecovery(deciding, command, state);
  }
  if (command.kind === 'assign') {
    return decidedGiving(deciding.table, command, state);
  }
  if (command.kind === 'unassign') {
    return decidedTaking(deciding.table, command, state);
  }
  if (command.kind === 'enrol') {
    return decidedEnrolment(deciding, command, state);
  }
  return command.kind === 'provision'
    ? decidedProvisioning(deciding.table, command, state)
    : decidedDeprovisioning(deciding.table, command, state);
}

export function roleAssignmentDeciderOver(table: RoleTable, atSignIn: RolesAtSignIn): RoleAssignmentDecider {
  return {
    initialState: noneHeld,
    evolve: evolvedBy,
    decide: (command, state) => decided({ table, atSignIn }, command, state),
    context: ({ at, by }) => ({ at, by }),
    eventSchema: RoleAssignmentEventSchema,
  };
}

export const roleAssignmentDecider = roleAssignmentDeciderOver(builtInRoles, builtInRolesAtSignIn);
