import { HashMap, Option } from 'effect';

import { builtInRoleIds, type BuiltInRoleId, type DefaultRoleId, type RoleTable } from '../roles/built-in-roles.ts';
import {
  principalKeyOf,
  type AssignedPrincipal,
  type AssignedRole,
  type AssignmentScope,
  type AssignmentSource,
  type Enrolment,
  type RoleAssignmentChange,
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

type InvitationStatus = 'pending' | 'accepted' | 'revoked';

interface KnownInvitation {
  readonly role: AssignedRole;
  readonly expiresAt: string;
  readonly status: InvitationStatus;
}

export interface Joining {
  readonly enrolment: Enrolment;
  readonly defaultRole: DefaultRoleId;
}

export interface HeldAssignments {
  readonly byPrincipal: HashMap.HashMap<string, HeldBy>;
  readonly holders: Readonly<Record<BuiltInRoleId, number>>;
  readonly lastEndedBy: HashMap.HashMap<string, AssignmentSource>;
  readonly invitations: HashMap.HashMap<string, KnownInvitation>;
  readonly joiningSet: Joining | undefined;
}

export const noneHeld: HeldAssignments = {
  byPrincipal: HashMap.empty(),
  holders: { admin: 0, editor: 0, operator: 0, viewer: 0 },
  lastEndedBy: HashMap.empty(),
  invitations: HashMap.empty(),
  joiningSet: undefined,
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

export interface PendingInvitation {
  readonly invitation: string;
  readonly role: AssignedRole;
  readonly expiresAt: string;
}

function isPendingAt({ status, expiresAt }: KnownInvitation, at: string): boolean {
  return status === 'pending' && Date.parse(expiresAt) > Date.parse(at);
}

export function pendingInvitationOf(
  state: HeldAssignments,
  invitation: string | undefined,
  at: string,
): PendingInvitation | undefined {
  const known = invitation === undefined ? Option.none() : HashMap.get(state.invitations, invitation);
  const pending = Option.filter(known, (each) => isPendingAt(each, at));
  return Option.getOrUndefined(
    Option.map(pending, ({ role, expiresAt }) => ({ invitation: String(invitation), role, expiresAt })),
  );
}

export function pendingInvitationsIn(state: HeldAssignments, at: string): readonly PendingInvitation[] {
  return [...HashMap.entries(state.invitations)].flatMap(([invitation, known]: readonly [string, KnownInvitation]) =>
    isPendingAt(known, at) ? [{ invitation, role: known.role, expiresAt: known.expiresAt }] : [],
  );
}

export function hasEnded(state: HeldAssignments, invitation: string): boolean {
  return Option.exists(HashMap.get(state.invitations, invitation), ({ status }) => status !== 'pending');
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

function changedBy(state: HeldAssignments, { type, data }: RoleAssignmentChange): HeldAssignments {
  const key = principalKeyOf(data.principal);
  const held = rolesHeldBy(state, data.principal);
  const others = held.filter(({ id }) => id !== data.role.id);
  const roles = type === 'role_assigned' ? [...others, data.role] : others;
  return {
    ...state,
    byPrincipal:
      roles.length === 0
        ? HashMap.remove(state.byPrincipal, key)
        : HashMap.set(state.byPrincipal, key, { principal: data.principal, roles }),
    holders: { ...state.holders, [data.role.id]: state.holders[data.role.id] + roles.length - held.length },
    lastEndedBy: lastEndedAfter(state, { key, held, roles, source: data.source }),
  };
}

function endedAs(state: HeldAssignments, invitation: string, status: InvitationStatus): HeldAssignments {
  return {
    ...state,
    invitations: HashMap.modify(state.invitations, invitation, (known) => ({ ...known, status })),
  };
}

type InvitationEvent = Extract<
  RoleAssignmentEvent,
  { readonly type: 'member_invited' | 'invitation_revoked' | 'invitation_accepted' }
>;

function invitationsChangedBy(state: HeldAssignments, event: InvitationEvent): HeldAssignments {
  if (event.type === 'member_invited') {
    const { invitation, role, expires_at: expiresAt } = event.data;
    return {
      ...state,
      invitations: HashMap.set(state.invitations, invitation, { role, expiresAt, status: 'pending' }),
    };
  }
  return endedAs(state, event.data.invitation, event.type === 'invitation_revoked' ? 'revoked' : 'accepted');
}

export function evolvedBy(state: HeldAssignments, event: RoleAssignmentEvent): HeldAssignments {
  if (event.type === 'role_assigned' || event.type === 'role_unassigned') {
    return changedBy(state, event);
  }
  return event.type === 'enrolment_set'
    ? { ...state, joiningSet: { enrolment: event.data.enrolment, defaultRole: event.data.role.id } }
    : invitationsChangedBy(state, event);
}

export function assignedOf(
  { principal, role }: HeldAssignment,
  scope: AssignmentScope,
  source: AssignmentSource,
): RoleAssignmentChange {
  return { type: 'role_assigned', data: { principal, role, scope, source } };
}

export function unassignedOf(
  { principal, role }: HeldAssignment,
  scope: AssignmentScope,
  source: AssignmentSource,
): RoleAssignmentChange {
  return { type: 'role_unassigned', data: { principal, role, scope, source } };
}

export function holdsAnAssigner(table: RoleTable, { holders }: HeldAssignments): boolean {
  return builtInRoleIds.some((id) => table[id].assignsRoles && holders[id] > 0);
}
