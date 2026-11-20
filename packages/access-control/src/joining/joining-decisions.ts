import { Forbidden, roleRefusalDetail, roleRefusalKind, type PrincipalReference } from '@on.auto/operations';
import { Result } from 'effect';

import { rolesHeldBy, type HeldAssignments, type Joining } from '../assignments/held-assignments.ts';
import type { Decision, EnrolmentSet, RoleAssignmentCommand } from '../assignments/role-assignment-commands.ts';
import type { DefaultRole, Enrolment } from '../assignments/role-assignment-facts.ts';
import type { Deciding } from '../assignments/sign-in-decisions.ts';
import {
  builtInRolesAtSignIn,
  type DefaultRoleId,
  type RolesAtSignIn,
  type RoleTable,
} from '../roles/built-in-roles.ts';

const startingEnrolment: Enrolment = 'join_without_invitation';

export function joiningOver({ enrolment }: RolesAtSignIn, { joiningSet }: HeldAssignments): Joining {
  return joiningSet ?? { enrolment: startingEnrolment, defaultRole: enrolment };
}

export const startingDefaultRole: DefaultRoleId = builtInRolesAtSignIn.enrolment;

export function joiningIn(state: HeldAssignments): Joining {
  return joiningOver(builtInRolesAtSignIn, state);
}

function refusedToOneWhoGivesNoRoles(
  table: RoleTable,
  state: HeldAssignments,
  actor: PrincipalReference,
): Forbidden | undefined {
  return rolesHeldBy(state, actor).some(({ id }) => table[id].assignsRoles)
    ? undefined
    : new Forbidden({ detail: roleRefusalDetail, kind: roleRefusalKind });
}

const builtIn = (id: DefaultRoleId): DefaultRole => ({ type: 'built_in', id });

function changes(before: Joining, after: Joining): boolean {
  return before.enrolment !== after.enrolment || before.defaultRole !== after.defaultRole;
}

export function isEnrolmentSetting(command: RoleAssignmentCommand): command is EnrolmentSet {
  return command.kind === 'set_enrolment';
}

export function decidedEnrolmentSetting(
  { table, atSignIn }: Deciding,
  command: EnrolmentSet,
  state: HeldAssignments,
): Decision {
  const refusal = refusedToOneWhoGivesNoRoles(table, state, command.actor);
  if (refusal !== undefined) {
    return Result.fail(refusal);
  }
  const before = joiningOver(atSignIn, state);
  const after: Joining = { enrolment: command.enrolment, defaultRole: command.role?.id ?? before.defaultRole };
  return Result.succeed(
    changes(before, after)
      ? [
          {
            type: 'enrolment_set',
            data: {
              enrolment: after.enrolment,
              previous_enrolment: before.enrolment,
              role: builtIn(after.defaultRole),
              previous_role: builtIn(before.defaultRole),
              scope: command.scope,
            },
          },
        ]
      : [],
  );
}
