import { decisionLoop } from '@on.auto/ledger';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { pendingInvitationsIn } from '../assignments/held-assignments.ts';
import type { RoleAssignmentCommand, RolesDeprovisioned } from '../assignments/role-assignment-commands.ts';
import { roleAssignmentDecider } from '../assignments/role-assignment-decider.ts';
import type { AssignedPrincipal, RoleAssignmentEvent } from '../assignments/role-assignment-facts.ts';
import { enrolledAs } from '../assignments/sign-in-decisions.ts';
import {
  aStreamAnotherWriterAppendsTo,
  acceptedAs,
  acme,
  acted,
  ada,
  afterward,
  change,
  held,
  invitedBy,
  pairsIn,
  priya,
  recordedNow,
  resending,
  revoking,
  signingIn,
  stateOf,
  toNoor,
  toSam,
} from '../testing/role-assignment-states.ts';

const decide = roleAssignmentDecider.decide;

const sam: AssignedPrincipal = { type: 'person', id: 'user_sam' };

const pastItsEnd = '2026-12-14T15:20:00.000Z';

const carrying = (invitation: string, at = acted.at) => ({ invitation, at });

function acceptedBy(principal: AssignedPrincipal) {
  return [acceptedAs(toSam, 'editor', principal), change('role_assigned', principal, 'editor', 'invitation')];
}

function removed(principal: AssignedPrincipal, source: 'manual' | 'identity_service'): RolesDeprovisioned {
  return { kind: 'deprovision', source, principal, scope: acme, ...acted };
}

type Facts = readonly RoleAssignmentEvent[];

const stateWith = (...events: Facts) => stateOf(recordedNow(...events));

const anAdminInvitedSam = (): Facts => [
  change('role_assigned', ada, 'admin'),
  ...Result.getOrThrow(decide(invitedBy(ada, toSam, 'editor'), held([ada, 'admin']))),
];

const withoutAnAdmin = (): Facts => [
  ...anAdminInvitedSam(),
  ...Result.getOrThrow(decide(removed(ada, 'identity_service'), held([ada, 'admin']))),
];

const enrolledAsAViewer = Result.succeed([change('role_assigned', sam, 'viewer', 'enrolment')]);

describe('a person who signs in carrying an invitation pending', () => {
  it('who holds no role is given its role, by invitation, and the invitation accepted, in one decision, whether they never joined or were removed', () => {
    const state = stateWith(
      ...anAdminInvitedSam(),
      change('role_assigned', priya, 'viewer'),
      change('role_unassigned', priya, 'viewer'),
    );

    expect([decide(signingIn(sam, toSam), state), decide(signingIn(priya, toSam), state)]).toEqual([
      Result.succeed(acceptedBy(sam)),
      Result.succeed(acceptedBy(priya)),
    ]);
    expect([enrolledAs(state, sam, carrying(toSam)), enrolledAs(state, priya, carrying(toSam))]).toEqual([
      'invitation',
      'invitation',
    ]);
  });

  it('who holds a role changes nothing, and where the organization has no admin yet becomes its admin, the invitation staying pending each time', () => {
    const member = stateWith(...anAdminInvitedSam(), change('role_assigned', priya, 'viewer'));

    expect([decide(signingIn(priya, toSam), member), enrolledAs(member, priya, carrying(toSam))]).toEqual([
      Result.succeed([]),
      'member',
    ]);
    expect(decide(signingIn(sam, toSam), stateWith(...withoutAnAdmin()))).toEqual(
      Result.succeed([change('role_assigned', sam, 'admin', 'bootstrap')]),
    );
    expect(pendingInvitationsIn(stateWith(...withoutAnAdmin()), acted.at)).toHaveLength(1);
  });
});

describe('a person who signs in carrying an invitation no longer pending', () => {
  it('revoked, resent or accepted, is decided as if they carried none', () => {
    const invited = anAdminInvitedSam();
    const ended = [
      stateWith(...invited, ...Result.getOrThrow(decide(revoking(toSam), stateWith(...invited)))),
      stateWith(...invited, ...Result.getOrThrow(decide(resending(toSam, toNoor), stateWith(...invited)))),
      stateWith(...invited, ...acceptedBy(priya)),
    ];

    expect(ended.map((state) => decide(signingIn(sam, toSam), state))).toEqual(ended.map(() => enrolledAsAViewer));
  });

  it('past its end, or an id it was never given, is decided as if they carried none, and refused once an admin removed them', () => {
    const invited = anAdminInvitedSam();
    const removedBefore = stateWith(
      ...invited,
      change('role_assigned', sam, 'viewer'),
      change('role_unassigned', sam, 'viewer'),
    );

    expect([
      decide(signingIn(sam, toSam, pastItsEnd), stateWith(...invited)),
      decide(signingIn(sam, 'an-id-from-a-listing'), stateWith(...invited)),
      decide(signingIn(sam, toSam, pastItsEnd), removedBefore),
    ]).toEqual([enrolledAsAViewer, enrolledAsAViewer, Result.succeed([])]);
    expect(enrolledAs(removedBefore, sam, carrying(toSam, pastItsEnd))).toBe('removed');
  });
});

async function decidedAgainAfter(first: Facts, landsFirst: RoleAssignmentCommand, second: RoleAssignmentCommand) {
  const stream = aStreamAnotherWriterAppendsTo(recordedNow(...first));
  stream.landsFirst(Result.getOrThrow(decide(landsFirst, stream.state())));
  const loop = decisionLoop(stream.load, stream.append, roleAssignmentDecider);
  const decided = await Effect.runPromise(loop('role-assignments/acme', second));
  return { events: decided.events.map(({ type, data }) => ({ type, data })), state: stream.state() };
}

describe('two people carrying one link at once', () => {
  it('leave one to accept it: the one whose append lands first, the other decided again as if they carried none', async () => {
    const { events, state } = await decidedAgainAfter(
      anAdminInvitedSam(),
      signingIn(priya, toSam),
      signingIn(sam, toSam),
    );

    expect(events).toEqual([change('role_assigned', sam, 'viewer', 'enrolment')]);
    expect(pairsIn(state)).toEqual([
      ['user_ada', 'admin'],
      ['user_priya', 'editor'],
      ['user_sam', 'viewer'],
    ]);
  });
});

describe('an accept against a revoke or a resend made at once', () => {
  it('leaves the one decided second to decide again on what the first recorded', async () => {
    const afterTheRevoke = await decidedAgainAfter(anAdminInvitedSam(), revoking(toSam), signingIn(sam, toSam));
    const afterTheResend = await decidedAgainAfter(
      anAdminInvitedSam(),
      resending(toSam, toNoor),
      signingIn(sam, toSam),
    );
    const revokeAfter = await decidedAgainAfter(anAdminInvitedSam(), signingIn(sam, toSam), revoking(toSam));
    const resendAfter = await decidedAgainAfter(anAdminInvitedSam(), signingIn(sam, toSam), resending(toSam, toNoor));

    expect([afterTheRevoke.events, afterTheResend.events]).toEqual([
      [change('role_assigned', sam, 'viewer', 'enrolment')],
      [change('role_assigned', sam, 'viewer', 'enrolment')],
    ]);
    expect([revokeAfter.events, resendAfter.events]).toEqual([[], []]);
    expect(pendingInvitationsIn(afterTheResend.state, acted.at).map(({ invitation }) => invitation)).toEqual([toNoor]);
  });
});

describe('an accept against a removal of the same person', () => {
  it('a removal recorded first revokes the invitations to them, so their link signs nobody in, and an accept recorded first leaves the removal nothing to revoke', () => {
    const member = [...anAdminInvitedSam(), change('role_assigned', sam, 'viewer')];
    const removal: RolesDeprovisioned = { ...removed(sam, 'manual'), invitations: [toSam] };
    const removedFirst = afterward(stateWith(...member), Result.getOrThrow(decide(removal, stateWith(...member))));
    const leftBefore = [...member, change('role_unassigned', sam, 'viewer')];
    const acceptedFirst = afterward(stateWith(...leftBefore), acceptedBy(sam));

    expect([decide(signingIn(sam, toSam), removedFirst), enrolledAs(removedFirst, sam, carrying(toSam))]).toEqual([
      Result.succeed([]),
      'removed',
    ]);
    expect(decide(removal, acceptedFirst)).toEqual(Result.succeed([change('role_unassigned', sam, 'editor')]));
  });
});

describe('a first sign-in against an accept, where the org has no admin', () => {
  it('lands the first as the admin, and the other accepts the invitation once decided again', async () => {
    const { events, state } = await decidedAgainAfter(withoutAnAdmin(), signingIn(priya), signingIn(sam, toSam));

    expect(events).toEqual(acceptedBy(sam));
    expect(pairsIn(state)).toEqual([
      ['user_priya', 'admin'],
      ['user_sam', 'editor'],
    ]);
  });
});
