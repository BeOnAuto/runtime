import { Forbidden, roleRefusalDetail, roleRefusalKind } from '@on.auto/operations';
import { DateTime, Duration, Result } from 'effect';

import {
  assignedOf,
  pendingInvitationOf,
  rolesHeldBy,
  type HeldAssignments,
  type PendingInvitation,
} from '../assignments/held-assignments.ts';
import type {
  Decision,
  InvitationResent,
  InvitationRevoked,
  MemberInvited,
  PersonEnrolled,
  RoleAssignmentCommand,
} from '../assignments/role-assignment-commands.ts';
import type {
  AssignmentScope,
  InvitationRevokedReason,
  RoleAssignmentEvent,
} from '../assignments/role-assignment-facts.ts';
import { mayInvite, type RoleTable } from '../roles/built-in-roles.ts';

const invitationLasts = Duration.days(30);

export function invitationEndsAt(at: string): string {
  return DateTime.formatIso(DateTime.addDuration(DateTime.makeUnsafe(at), invitationLasts));
}

function revokedOf(
  { invitation, role }: PendingInvitation,
  scope: AssignmentScope,
  reason: InvitationRevokedReason,
): RoleAssignmentEvent {
  return { type: 'invitation_revoked', data: { invitation, role, scope, reason } };
}

interface RevokingTheirs {
  readonly state: HeldAssignments;
  readonly scope: AssignmentScope;
  readonly at: string;
  readonly invitations?: readonly string[];
}

function revokedAmong({ state, scope, at, invitations = [] }: RevokingTheirs, reason: InvitationRevokedReason) {
  return invitations.flatMap((invitation) => {
    const pending = pendingInvitationOf(state, invitation, at);
    return pending === undefined ? [] : [revokedOf(pending, scope, reason)];
  });
}

export function withTheirInvitationsRevoked(
  revoking: RevokingTheirs,
  reason: InvitationRevokedReason,
  events: readonly RoleAssignmentEvent[],
): readonly RoleAssignmentEvent[] {
  return events.length === 0 ? events : [...events, ...revokedAmong(revoking, reason)];
}

function invitedOf({
  invitation,
  role,
  scope,
  at,
}: Pick<MemberInvited, 'invitation' | 'role' | 'scope' | 'at'>): RoleAssignmentEvent {
  return { type: 'member_invited', data: { invitation, role, scope, expires_at: invitationEndsAt(at) } };
}

function decidedInvitation(table: RoleTable, command: MemberInvited, state: HeldAssignments): Decision {
  const held = rolesHeldBy(state, command.inviter);
  return held.some(({ id }) => mayInvite(table, id, command.role.id))
    ? Result.succeed([invitedOf(command)])
    : Result.fail(new Forbidden({ detail: roleRefusalDetail, kind: roleRefusalKind }));
}

function decidedRevocation(command: InvitationRevoked, state: HeldAssignments): Decision {
  const pending = pendingInvitationOf(state, command.invitation, command.at);
  return Result.succeed(pending === undefined ? [] : [revokedOf(pending, command.scope, 'revoked')]);
}

function decidedResending(command: InvitationResent, state: HeldAssignments): Decision {
  const pending = pendingInvitationOf(state, command.invitation, command.at);
  return Result.succeed(
    pending === undefined
      ? []
      : [
          revokedOf(pending, command.scope, 'resent'),
          invitedOf({ ...command, invitation: command.replacement, role: pending.role }),
        ],
  );
}

type OfInvitations = MemberInvited | InvitationRevoked | InvitationResent;

const kindsOfInvitations: ReadonlySet<RoleAssignmentCommand['kind']> = new Set(['invite', 'revoke', 'resend']);

export function isOfInvitations(command: RoleAssignmentCommand): command is OfInvitations {
  return kindsOfInvitations.has(command.kind);
}

export function decidedOfInvitations(table: RoleTable, command: OfInvitations, state: HeldAssignments): Decision {
  if (command.kind === 'invite') {
    return decidedInvitation(table, command, state);
  }
  return command.kind === 'revoke' ? decidedRevocation(command, state) : decidedResending(command, state);
}

export function acceptedBy(
  { principal, scope }: PersonEnrolled,
  { invitation, role }: PendingInvitation,
): readonly RoleAssignmentEvent[] {
  return [
    { type: 'invitation_accepted', data: { invitation, role, scope, principal } },
    assignedOf({ principal, role }, scope, 'invitation'),
  ];
}
