import type { invitedRoles } from '@on.auto/access-control';
import {
  EmailAddressField,
  InvitationField,
  InvitationMadeSchema,
  InvitationSchema,
  InvitedRoleField,
  invitationEndsAt,
  pendingInvitationOf,
  roleAssignmentDecider,
  type HeldAssignments,
  type InvitationMade,
} from '@on.auto/access-control';
import type { AssignedPrincipal } from '@on.auto/access-control/role-assignment-facts';
import {
  Caller,
  Conflict,
  Forbidden,
  NotFound,
  OrgWriter,
  defineCommand,
  defineHttpOperation,
  signedInPersonPrefix,
  type CallerIdentity,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { invitationLinkAt } from './invitation-links.ts';
import { forgottenOnceEnded, writtenNow } from './member-changes.ts';
import {
  aPerson,
  addressesOf,
  inLowerCase,
  invitationOf,
  membersIn,
  pendingIn,
  rolesNowOf,
  rolesOf,
  theOrg,
  type MembersKept,
  type RoleId,
} from './members-read.ts';

export const noSuchInvitation = 'This organization has no such invitation pending.';

export const addressTaken = 'This email address already belongs to a member or has a pending invitation.';

const addressTakenExplained = {
  why: 'that email address already belongs to a member or has a pending invitation',
  remedy: 'list_members shows the members and the pending invitations.',
};

export const noPerson = 'An org’s members are managed by a person signed in to it, and an API key acts for no person';

const INVITED_AS: Readonly<Record<(typeof invitedRoles)[number], string>> = {
  editor: 'an editor',
  operator: 'an operator',
  viewer: 'a viewer',
};

function inviterOf({ id }: CallerIdentity): Effect.Effect<AssignedPrincipal, Forbidden> {
  return id.startsWith(signedInPersonPrefix)
    ? Effect.succeed(aPerson(id.slice(signedInPersonPrefix.length)))
    : Effect.fail(new Forbidden({ detail: noPerson }));
}

function addressFree(kept: MembersKept, org: string, emailAddress: string, at: string) {
  return Effect.gen(function* () {
    const asked = inLowerCase(emailAddress);
    const pending = pendingIn(yield* rolesNowOf(org), yield* addressesOf(kept), at);
    const members = yield* membersIn(kept);
    const inUse = [
      ...pending.map(({ email_address }) => email_address),
      ...members.flatMap(({ identifier }) => (identifier === null ? [] : [identifier])),
    ];
    return inUse.some((address) => inLowerCase(address) === asked)
      ? yield* new Conflict({ detail: addressTaken, kind: 'taken' })
      : undefined;
  });
}

function invitedAs(kept: MembersKept, role: RoleId, emailAddress: string) {
  return Effect.gen(function* () {
    const inviter = yield* inviterOf(yield* Caller);
    const { org, by, at } = yield* writtenNow;
    yield* addressFree(kept, org, emailAddress, at);
    const { invitation, link } = invitationLinkAt(kept.publicUrl);
    const address = { invitation, emailAddress, invitedAt: Date.parse(at) };
    yield* Effect.promise(() => kept.invitations.kept(address));
    const inviting = { kind: 'invite', inviter, invitation, role: { type: 'built_in', id: role } } as const;
    const { state } = yield* (yield* OrgWriter).execute(rolesOf(org), roleAssignmentDecider, {
      ...inviting,
      scope: theOrg(org),
      at,
      by,
    });
    yield* forgottenOnceEnded(kept, org, state, at);
    const made: InvitationMade = { ...invitationOf(address, role, invitationEndsAt(at)), link };
    return made;
  });
}

const InvitedSchema = Schema.Struct({ email_address: EmailAddressField });

function defineInviteMember(kept: MembersKept) {
  return defineCommand('org', {
    name: 'invite_member',
    title: 'Invite member',
    description: [
      'Invites a person to the org as an editor, an operator or a viewer.',
      'It answers the invitation’s link, to give to the person who asked.',
      'Everything else with members is done by an admin in Studio: inviting an admin, resending or revoking an invitation, changing a role and removing a member.',
    ].join(' '),
    route: { method: 'POST', path: '/members/invitations' },
    successStatus: 201,
    inputSchema: Schema.Struct({ ...InvitedSchema.fields, role: Schema.optionalKey(InvitedRoleField) }),
    outputSchema: InvitationMadeSchema,
    reasons: ['forbidden', 'conflict'],
    handle: ({ email_address, role = 'editor' }) => invitedAs(kept, role, email_address),
    plainLanguage: {
      task: 'invite a person to the org',
      attempt: () => 'invite a person to the org',
      outcome: (_invited, { role = 'editor' }) =>
        `Invited them as ${INVITED_AS[role]}. No email is sent. Give the link to the person who asked, to share with them. They join once they accept the invitation.`,
      explanations: { taken: addressTakenExplained },
    },
  });
}

function defineInviteAdmin(kept: MembersKept) {
  return defineHttpOperation('org', 'command', {
    name: 'invite_admin',
    title: 'Invite admin',
    description: [
      'Invites a person to the org as an admin, who manages its members once they join, and answers the invitation’s link.',
      'Only an admin invites an admin.',
    ].join(' '),
    route: { method: 'POST', path: '/members/admin-invitations' },
    body: { kind: 'json' },
    successStatus: 201,
    inputSchema: InvitedSchema,
    outputSchema: InvitationMadeSchema,
    permissionsManagement: true,
    reasons: ['forbidden', 'conflict'],
    handle: ({ email_address }) => invitedAs(kept, 'admin', email_address),
  });
}

function addressOfThe(kept: MembersKept, invitation: string) {
  return Effect.flatMap(addressesOf(kept), (addresses) => {
    const address = addresses.find((each) => each.invitation === invitation);
    return address === undefined ? Effect.fail(new NotFound({ detail: noSuchInvitation })) : Effect.succeed(address);
  });
}

function stillPendingIn(state: HeldAssignments, invitation: string, at: string) {
  const pending = pendingInvitationOf(state, invitation, at);
  return pending === undefined ? Effect.fail(new NotFound({ detail: noSuchInvitation })) : Effect.succeed(pending);
}

function defineResendInvitation(kept: MembersKept) {
  return defineHttpOperation('org', 'command', {
    name: 'resend_invitation',
    title: 'Resend invitation',
    description: [
      'Replaces an invitation of the org still pending with a new one, to the same address and with the same role, and answers its link.',
      'The earlier link stops working.',
    ].join(' '),
    route: { method: 'POST', path: '/members/invitations/{invitation}/resend' },
    body: { kind: 'none' },
    successStatus: 201,
    inputSchema: Schema.Struct({ invitation: InvitationField }),
    outputSchema: InvitationMadeSchema,
    permissionsManagement: true,
    reasons: ['not_found'],
    handle: ({ invitation }) =>
      Effect.gen(function* () {
        const { org, by, at } = yield* writtenNow;
        const { emailAddress } = yield* addressOfThe(kept, invitation);
        yield* stillPendingIn(yield* rolesNowOf(org), invitation, at);
        const { invitation: replacement, link } = invitationLinkAt(kept.publicUrl);
        const address = { invitation: replacement, emailAddress, invitedAt: Date.parse(at) };
        yield* Effect.promise(() => kept.invitations.kept(address));
        const resending = { kind: 'resend', invitation, replacement } as const;
        const { state, decidedOn } = yield* (yield* OrgWriter)
          .execute(rolesOf(org), roleAssignmentDecider, { ...resending, scope: theOrg(org), at, by })
          .pipe(Effect.catchTags({ forbidden: Effect.die, conflict: Effect.die }));
        const { role } = yield* stillPendingIn(decidedOn, invitation, at);
        yield* forgottenOnceEnded(kept, org, state, at);
        const made: InvitationMade = { ...invitationOf(address, role.id, invitationEndsAt(at)), link };
        return made;
      }),
  });
}

function defineRevokeInvitation(kept: MembersKept) {
  return defineHttpOperation('org', 'command', {
    name: 'revoke_invitation',
    title: 'Revoke invitation',
    description: 'Revokes an invitation of the org still pending, so nobody joins by it.',
    route: { method: 'DELETE', path: '/members/invitations/{invitation}' },
    body: { kind: 'none' },
    inputSchema: Schema.Struct({ invitation: InvitationField }),
    outputSchema: InvitationSchema,
    permissionsManagement: true,
    reasons: ['not_found'],
    handle: ({ invitation }) =>
      Effect.gen(function* () {
        const { org, by, at } = yield* writtenNow;
        const address = yield* addressOfThe(kept, invitation);
        const revoking = { kind: 'revoke', invitation } as const;
        const { state, decidedOn } = yield* (yield* OrgWriter)
          .execute(rolesOf(org), roleAssignmentDecider, { ...revoking, scope: theOrg(org), at, by })
          .pipe(Effect.catchTags({ forbidden: Effect.die, conflict: Effect.die }));
        const { role, expiresAt } = yield* stillPendingIn(decidedOn, invitation, at);
        yield* forgottenOnceEnded(kept, org, state, at);
        return { ...invitationOf(address, role.id, expiresAt), status: 'revoked' };
      }),
  });
}

export function invitationOperationsOf(kept: MembersKept) {
  return [
    defineInviteMember(kept),
    defineInviteAdmin(kept),
    defineResendInvitation(kept),
    defineRevokeInvitation(kept),
  ] as const;
}
