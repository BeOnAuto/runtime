import { MemberField, MemberSchema, MembersSchema, RoleField, roleAssignmentDecider } from '@on.auto/access-control';
import { personSignedOut, type AuthStore } from '@on.auto/openid-connect';
import { Caller, NotFound, OrgWriter, defineHttpOperation, defineQuery } from '@on.auto/operations';
import { counted } from '@on.auto/phrasing';
import { Effect, Schema } from 'effect';

import type { AccountLinks } from '../account-linking/account-links.ts';
import { invitationOperationsOf } from './invitation-operations.ts';
import { joiningOperations } from './joining-operations.ts';
import { NothingAsked, actorOf, forgottenOnceEnded, inApprovedWords, writtenNow } from './member-changes.ts';
import {
  aPerson,
  addressesOf,
  memberOf,
  membersIn,
  pendingIn,
  rolesNowOf,
  rolesOf,
  standingOf,
  theOrg,
  toTheAddress,
  type MembersKept,
} from './members-read.ts';

export const noSuchMember = 'This organization has no such member.';

const signInsNotEndedMessage =
  'A member was removed and their sign-ins, or the accounts at other services linked to them, could not be ended now; each is refused while they hold no role, and a sign-in ends as it expires';

const mostListed = 500;

const MEMBER = { one: 'member', other: 'members' };

const INVITATION = { one: 'invitation', other: 'invitations' };

function defineListMembers(kept: MembersKept) {
  return defineQuery('org', {
    name: 'list_members',
    title: 'List members',
    description: [
      "Lists the org's members, their roles and the invitations pending.",
      'Use it when asked who is in the org.',
      'Anyone in the org lists them.',
    ].join(' '),
    route: { method: 'GET', path: '/members' },
    inputSchema: NothingAsked,
    outputSchema: MembersSchema,
    reasons: [],
    handle: () =>
      Effect.gen(function* () {
        const { org, at } = yield* writtenNow;
        const members = yield* membersIn(kept);
        const invitations = pendingIn(yield* rolesNowOf(org), yield* addressesOf(kept), at);
        return {
          members: members.slice(0, mostListed),
          members_total: members.length,
          invitations: invitations.slice(0, mostListed),
          invitations_total: invitations.length,
        };
      }),
    plainLanguage: {
      task: 'list the org’s members',
      attempt: () => 'list the org’s members',
      outcome: ({ members_total, invitations_total }) =>
        `The org has ${counted(members_total, MEMBER)}, and ${counted(invitations_total, INVITATION)} ${invitations_total === 1 ? 'is' : 'are'} pending.`,
    },
  });
}

function theirInvitations(kept: MembersKept, identifier: string | null) {
  return Effect.map(addressesOf(kept), (addresses) => toTheAddress(addresses, identifier));
}

function defineSetMemberRole(kept: MembersKept) {
  return defineHttpOperation('org', 'command', {
    name: 'set_member_role',
    title: 'Set member role',
    description: 'Gives a member of the org a role, admin, editor or viewer, never leaving the org without an admin.',
    route: { method: 'PUT', path: '/members/{member}/role' },
    body: { kind: 'json' },
    inputSchema: Schema.Struct({ member: MemberField, role: RoleField }),
    outputSchema: MemberSchema,
    permissionsManagement: true,
    reasons: ['forbidden', 'not_found', 'conflict'],
    handle: ({ member, role }) =>
      Effect.gen(function* () {
        const actor = yield* actorOf(yield* Caller);
        const standing = yield* standingOf(kept, member);
        if (standing?.role === undefined) {
          return yield* new NotFound({ detail: noSuchMember });
        }
        const { org, by, at } = yield* writtenNow;
        const invitations = yield* theirInvitations(kept, standing.profile.identifier);
        const given = { type: 'built_in', id: role } as const;
        const assigning = { kind: 'assign', actor, principal: aPerson(member), role: given, invitations } as const;
        const { state } = yield* (yield* OrgWriter)
          .execute(rolesOf(org), roleAssignmentDecider, { ...assigning, scope: theOrg(org), at, by })
          .pipe(Effect.mapError(inApprovedWords));
        yield* forgottenOnceEnded(kept, org, state, at);
        return memberOf(standing.profile, role);
      }),
  });
}

function defineRemoveMember(kept: MembersKept) {
  const signedOutBeside = (org: string, person: string) =>
    Effect.tryPromise(() => kept.signedOut(person)).pipe(
      Effect.catch(() =>
        Effect.logError(signInsNotEndedMessage).pipe(Effect.annotateLogs({ operation: 'remove_member', org })),
      ),
    );
  return defineHttpOperation('org', 'command', {
    name: 'remove_member',
    title: 'Remove member',
    description:
      'Removes a member from the org, never its last admin, revokes the invitations pending to their address, and answers the member as they were.',
    route: { method: 'DELETE', path: '/members/{member}' },
    body: { kind: 'none' },
    inputSchema: Schema.Struct({ member: MemberField }),
    outputSchema: MemberSchema,
    permissionsManagement: true,
    reasons: ['forbidden', 'not_found', 'conflict'],
    handle: ({ member }) =>
      Effect.gen(function* () {
        const standing = yield* standingOf(kept, member);
        const role = standing?.role;
        if (standing === undefined || role === undefined) {
          return yield* new NotFound({ detail: noSuchMember });
        }
        const { org, by, at } = yield* writtenNow;
        const invitations = yield* theirInvitations(kept, standing.profile.identifier);
        const ending = { kind: 'deprovision', source: 'manual', principal: aPerson(member), invitations } as const;
        const { state } = yield* (yield* OrgWriter).execute(rolesOf(org), roleAssignmentDecider, {
          ...ending,
          scope: theOrg(org),
          at,
          by,
        });
        yield* signedOutBeside(org, member);
        yield* forgottenOnceEnded(kept, org, state, at);
        return memberOf(standing.profile, role);
      }),
  });
}

export function memberOperationsOf(kept: MembersKept) {
  return [
    defineListMembers(kept),
    ...invitationOperationsOf(kept),
    defineSetMemberRole(kept),
    defineRemoveMember(kept),
    ...joiningOperations,
  ] as const;
}

const noLinks: Pick<AccountLinks, 'personForgotten'> = { personForgotten: () => Promise.resolve() };

export function signedOutWithTheirLinks(
  providerRows: Parameters<typeof personSignedOut>[0],
  links: Pick<AccountLinks, 'personForgotten'>,
): MembersKept['signedOut'] {
  return async (person) => {
    await Promise.all([personSignedOut(providerRows, person), links.personForgotten(person)]);
  };
}

export function memberOperationsOver(
  {
    peopleRows,
    providerRows,
    invitationAddresses,
  }: Pick<AuthStore, 'peopleRows' | 'providerRows' | 'invitationAddresses'>,
  publicUrl: string,
  links: Pick<AccountLinks, 'personForgotten'> = noLinks,
) {
  return memberOperationsOf({
    people: peopleRows,
    invitations: invitationAddresses,
    signedOut: signedOutWithTheirLinks(providerRows, links),
    publicUrl,
  });
}
