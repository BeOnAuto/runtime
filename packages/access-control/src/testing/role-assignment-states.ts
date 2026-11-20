import { VersionConflict, type DecidedPlace } from '@on.auto/ledger';
import { recordingOf, type PrincipalReference } from '@on.auto/operations';
import { Effect } from 'effect';

import { heldAssignmentsIn, type HeldAssignment, type HeldAssignments } from '../assignments/held-assignments.ts';
import type {
  InvitationResent,
  InvitationRevoked,
  MemberInvited,
  PersonEnrolled,
  RoleGiven,
  RoleTaken,
} from '../assignments/role-assignment-commands.ts';
import { roleAssignmentDecider } from '../assignments/role-assignment-decider.ts';
import {
  RoleAssignmentEventSchema,
  type AssignedPrincipal,
  type AssignmentScope,
  type AssignmentSource,
  type RecordedRoleAssignmentEvent,
  type RoleAssignmentChange,
  type RoleAssignmentEvent,
} from '../assignments/role-assignment-facts.ts';
import type { BuiltInRoleId } from '../roles/built-in-roles.ts';

export const toSam = '9b74c9897bac770ffc029102a200c5de1f8b7c1f3b6e1ad2f0d2b3e1c4a5f6e7';

export const toNoor = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';

export const aMonthOn = '2026-12-14T15:20:00.000Z';

export const acme: AssignmentScope = { type: 'org', id: 'acme' };

export const acted = { at: '2026-11-14T15:20:00.000Z', by: 'person:user_ada' };

function person(id: string): AssignedPrincipal {
  return { type: 'person', id };
}

export const ada = person('user_ada');
export const priya = person('user_priya');
export const dana = person('user_dana');

function actor({ id }: AssignedPrincipal): PrincipalReference {
  return { type: 'person', id };
}

function role(id: BuiltInRoleId) {
  return { type: 'built_in', id } as const;
}

export type Pair = readonly [AssignedPrincipal, BuiltInRoleId];

export function assignmentsOf(...pairs: readonly Pair[]): readonly HeldAssignment[] {
  return pairs.map(([principal, id]) => ({ principal, role: role(id) }));
}

export function held(...pairs: readonly Pair[]): HeldAssignments {
  return assignmentsOf(...pairs).reduce(
    (state, assignment) =>
      roleAssignmentDecider.evolve(state, {
        type: 'role_assigned',
        data: { ...assignment, scope: acme, source: 'import' },
        context: acted,
      }),
    roleAssignmentDecider.initialState,
  );
}

export function pairsIn(state: HeldAssignments): readonly (readonly [string, string])[] {
  return heldAssignmentsIn(state)
    .map(({ principal, role: { id } }): readonly [string, string] => [principal.id, id])
    .toSorted(([left], [right]) => left.localeCompare(right));
}

export function given(by: AssignedPrincipal, to: AssignedPrincipal, id: BuiltInRoleId): RoleGiven {
  return { kind: 'assign', actor: actor(by), principal: to, role: role(id), scope: acme, ...acted };
}

export function taken(by: AssignedPrincipal, from: AssignedPrincipal, id: BuiltInRoleId): RoleTaken {
  return { kind: 'unassign', actor: actor(by), principal: from, role: role(id), scope: acme, ...acted };
}

export function invitedBy(
  inviter: AssignedPrincipal,
  invitation: string,
  id: BuiltInRoleId,
  at = acted.at,
): MemberInvited {
  return { kind: 'invite', inviter, invitation, role: role(id), scope: acme, ...acted, at };
}

export function revoking(invitation: string, at = acted.at): InvitationRevoked {
  return { kind: 'revoke', invitation, scope: acme, ...acted, at };
}

export function resending(invitation: string, replacement: string, at = acted.at): InvitationResent {
  return { kind: 'resend', invitation, replacement, scope: acme, ...acted, at };
}

export function signingIn(principal: AssignedPrincipal, invitation?: string, at = acted.at): PersonEnrolled {
  return {
    kind: 'enrol',
    principal,
    scope: acme,
    ...acted,
    at,
    by: `person:${principal.id}`,
    invitation,
  };
}

export function invitedAs(invitation: string, id: BuiltInRoleId, expiresAt = aMonthOn): RoleAssignmentEvent {
  return {
    type: 'member_invited',
    data: { invitation, role: role(id), scope: acme, expires_at: expiresAt },
  };
}

export function revokedAs(
  invitation: string,
  id: BuiltInRoleId,
  reason: 'revoked' | 'resent' | 'member_removed' | 'role_changed',
): RoleAssignmentEvent {
  return { type: 'invitation_revoked', data: { invitation, role: role(id), scope: acme, reason } };
}

export function acceptedAs(invitation: string, id: BuiltInRoleId, principal: AssignedPrincipal): RoleAssignmentEvent {
  return { type: 'invitation_accepted', data: { invitation, role: role(id), scope: acme, principal } };
}

export function change(
  type: RoleAssignmentChange['type'],
  principal: AssignedPrincipal,
  id: BuiltInRoleId,
  source: AssignmentSource = 'manual',
): RoleAssignmentChange {
  return { type, data: { principal, role: role(id), scope: acme, source } };
}

const recordedAs = recordingOf(RoleAssignmentEventSchema);

export function recordedNow(...events: readonly RoleAssignmentEvent[]): readonly RecordedRoleAssignmentEvent[] {
  return events.map((event) => recordedAs(event, acted));
}

export function stateOf(facts: readonly RecordedRoleAssignmentEvent[]): HeldAssignments {
  return facts.reduce((state, fact) => roleAssignmentDecider.evolve(state, fact), roleAssignmentDecider.initialState);
}

export function afterward(state: HeldAssignments, events: readonly RoleAssignmentEvent[]): HeldAssignments {
  return recordedNow(...events).reduce((folded, fact) => roleAssignmentDecider.evolve(folded, fact), state);
}

export function aStreamAnotherWriterAppendsTo(first: readonly RecordedRoleAssignmentEvent[]) {
  const recorded = [...first];
  const meanwhile: RoleAssignmentEvent[] = [];
  return {
    landsFirst: (events: readonly RoleAssignmentEvent[]) => {
      meanwhile.push(...events);
    },
    state: () => stateOf(recorded),
    load: () => Effect.sync(() => ({ state: stateOf(recorded), version: recorded.length })),
    append: (_stream: string, events: readonly RoleAssignmentEvent[], place: DecidedPlace) =>
      Effect.suspend(() => {
        recorded.push(...meanwhile.splice(0).map((event) => recordedAs(event, place.context)));
        if (place.expectedVersion !== recorded.length) {
          return Effect.fail(new VersionConflict());
        }
        recorded.push(...events.map((event) => recordedAs(event, place.context)));
        return Effect.void;
      }),
  };
}
