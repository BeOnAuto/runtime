import { HashMap, Option, Result } from 'effect';

import { acceptedBy } from '../invitations/invitation-decisions.ts';
import { joiningOver } from '../joining/joining-decisions.ts';
import {
  builtInRoles,
  builtInRolesAtSignIn,
  type BuiltInRoleId,
  type RolesAtSignIn,
  type RoleTable,
} from '../roles/built-in-roles.ts';
import {
  assignedOf,
  holdsAnAssigner,
  pendingInvitationOf,
  rolesHeldBy,
  unassignedOf,
  type HeldAssignments,
  type PendingInvitation,
} from './held-assignments.ts';
import type { AdminRecovered, Decision, PersonEnrolled } from './role-assignment-commands.ts';
import {
  principalKeyOf,
  type AssignedPrincipal,
  type AssignedRole,
  type AssignmentSource,
  type RoleAssignmentEvent,
} from './role-assignment-facts.ts';

export type Enrolled = 'bootstrap' | 'enrolment' | 'invitation' | 'invitation_needed' | 'member' | 'removed';

export interface Deciding {
  readonly table: RoleTable;
  readonly atSignIn: RolesAtSignIn;
}

function mayBeEnrolled({ lastEndedBy }: HeldAssignments, principal: AssignedPrincipal): boolean {
  return Option.match(HashMap.get(lastEndedBy, principalKeyOf(principal)), {
    onNone: () => true,
    onSome: (source) => source !== 'manual',
  });
}

interface InvitationCarried {
  readonly invitation: string | undefined;
  readonly at: string;
}

const noInvitationCarried: InvitationCarried = { invitation: undefined, at: '' };

type EnrolmentDecided =
  | { readonly enrolled: Exclude<Enrolled, 'invitation'> }
  | { readonly enrolled: 'invitation'; readonly invited: PendingInvitation };

function enrolmentOver(
  { table, atSignIn }: Deciding,
  state: HeldAssignments,
  principal: AssignedPrincipal,
  { invitation, at }: InvitationCarried,
): EnrolmentDecided {
  if (!holdsAnAssigner(table, state)) {
    return { enrolled: 'bootstrap' };
  }
  if (rolesHeldBy(state, principal).length > 0) {
    return { enrolled: 'member' };
  }
  const invited = pendingInvitationOf(state, invitation, at);
  if (invited !== undefined) {
    return { enrolled: 'invitation', invited };
  }
  if (!mayBeEnrolled(state, principal)) {
    return { enrolled: 'removed' };
  }
  return { enrolled: joiningOver(atSignIn, state).enrolment === 'invitation' ? 'invitation_needed' : 'enrolment' };
}

export function enrolledAs(
  state: HeldAssignments,
  principal: AssignedPrincipal,
  carried: InvitationCarried = noInvitationCarried,
): Enrolled {
  return enrolmentOver({ table: builtInRoles, atSignIn: builtInRolesAtSignIn }, state, principal, carried).enrolled;
}

export function awaitsItsFirstAdmin(state: HeldAssignments): boolean {
  return !holdsAnAssigner(builtInRoles, state);
}

interface Enrolling {
  readonly atSignIn: RolesAtSignIn;
  readonly command: PersonEnrolled;
  readonly state: HeldAssignments;
}

function givenAtSignIn(
  { command: { principal, scope } }: Enrolling,
  source: keyof RolesAtSignIn,
  id: BuiltInRoleId,
): RoleAssignmentEvent {
  return assignedOf({ principal, role: { type: 'built_in', id } }, scope, source);
}

interface InPlaceOfTheRolesHeld {
  readonly state: HeldAssignments;
  readonly command: PersonEnrolled | AdminRecovered;
  readonly source: AssignmentSource;
}

function givenInPlaceOfTheRolesHeld(
  { state, command: { principal, scope }, source }: InPlaceOfTheRolesHeld,
  given: RoleAssignmentEvent,
): readonly RoleAssignmentEvent[] {
  return [...rolesHeldBy(state, principal).map((role) => unassignedOf({ principal, role }, scope, source)), given];
}

const enrolledWith: Readonly<
  Record<Exclude<Enrolled, 'invitation'>, (enrolling: Enrolling) => readonly RoleAssignmentEvent[]>
> = {
  bootstrap: (enrolling) =>
    givenInPlaceOfTheRolesHeld(
      { ...enrolling, source: 'bootstrap' },
      givenAtSignIn(enrolling, 'bootstrap', enrolling.atSignIn.bootstrap),
    ),
  enrolment: (enrolling) => [
    givenAtSignIn(enrolling, 'enrolment', joiningOver(enrolling.atSignIn, enrolling.state).defaultRole),
  ],
  invitation_needed: () => [],
  member: () => [],
  removed: () => [],
};

export function decidedEnrolment(deciding: Deciding, command: PersonEnrolled, state: HeldAssignments): Decision {
  const enrolment = enrolmentOver(deciding, state, command.principal, {
    invitation: command.invitation,
    at: command.at,
  });
  return Result.succeed(
    enrolment.enrolled === 'invitation'
      ? acceptedBy(command, enrolment.invited)
      : enrolledWith[enrolment.enrolled]({ atSignIn: deciding.atSignIn, command, state }),
  );
}

type Recovered = 'given' | 'held_already';

function roleOfTheFirstSignIn({ atSignIn }: Pick<Deciding, 'atSignIn'>): AssignedRole {
  return { type: 'built_in', id: atSignIn.bootstrap };
}

function recoveredOver(
  deciding: Pick<Deciding, 'atSignIn'>,
  state: HeldAssignments,
  principal: AssignedPrincipal,
): Recovered {
  const { id } = roleOfTheFirstSignIn(deciding);
  return rolesHeldBy(state, principal).some((held) => held.id === id) ? 'held_already' : 'given';
}

export function recoveredAs(state: HeldAssignments, principal: AssignedPrincipal): Recovered {
  return recoveredOver({ atSignIn: builtInRolesAtSignIn }, state, principal);
}

export function decidedRecovery(deciding: Deciding, command: AdminRecovered, state: HeldAssignments): Decision {
  if (recoveredOver(deciding, state, command.principal) === 'held_already') {
    return Result.succeed([]);
  }
  const given = assignedOf(
    { principal: command.principal, role: roleOfTheFirstSignIn(deciding) },
    command.scope,
    'command',
  );
  return Result.succeed(givenInPlaceOfTheRolesHeld({ state, command, source: 'command' }, given));
}
