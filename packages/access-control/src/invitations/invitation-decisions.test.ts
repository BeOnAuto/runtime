import { Conflict, Forbidden, roleRefusalDetail, roleRefusalKind } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { hasEnded, pendingInvitationsIn } from '../assignments/held-assignments.ts';
import type { RolesDeprovisioned } from '../assignments/role-assignment-commands.ts';
import { lastAssigner, roleAssignmentDecider } from '../assignments/role-assignment-decider.ts';
import {
  aMonthOn,
  acceptedAs,
  acme,
  acted,
  ada,
  change,
  dana,
  given,
  held,
  invitedAs,
  invitedBy,
  priya,
  recordedNow,
  resending,
  revokedAs,
  revoking,
  stateOf,
  toNoor,
  toSam,
} from '../testing/role-assignment-states.ts';

const decide = roleAssignmentDecider.decide;

const anHourAfterItsEnd = '2026-12-14T16:20:00.000Z';

const refusedForTheRole = Result.fail(new Forbidden({ detail: roleRefusalDetail, kind: roleRefusalKind }));

describe('an invitation made', () => {
  it('is one fact of a member invited, in the role asked, ending thirty days after it is made, made by a person whose role may invite to it', () => {
    const state = held([ada, 'admin'], [priya, 'editor']);

    expect([
      decide(invitedBy(ada, toSam, 'admin'), state),
      decide(invitedBy(priya, toSam, 'editor'), state),
      decide(invitedBy(priya, toSam, 'viewer'), state),
    ]).toEqual([
      Result.succeed([invitedAs(toSam, 'admin')]),
      Result.succeed([invitedAs(toSam, 'editor')]),
      Result.succeed([invitedAs(toSam, 'viewer')]),
    ]);
  });

  it('is refused in the approved words to a person whose role may not invite to the role asked: an editor asking for an admin, a viewer, and a person who holds no role', () => {
    const state = held([ada, 'admin'], [priya, 'editor'], [dana, 'viewer']);

    expect([
      decide(invitedBy(priya, toSam, 'admin'), state),
      decide(invitedBy(dana, toSam, 'viewer'), state),
      decide(invitedBy({ type: 'person', id: 'user_nobody' }, toSam, 'viewer'), state),
    ]).toEqual([refusedForTheRole, refusedForTheRole, refusedForTheRole]);
  });
});

const withSamInvited = () => stateOf(recordedNow(change('role_assigned', ada, 'admin'), invitedAs(toSam, 'editor')));

describe('an invitation revoked', () => {
  it('is one fact of the invitation revoked, by an admin, while it is pending', () => {
    expect(decide(revoking(toSam), withSamInvited())).toEqual(Result.succeed([revokedAs(toSam, 'editor', 'revoked')]));
  });

  it('records nothing for an invitation the org never made, one that ended, or one past its end', () => {
    const ended = stateOf(
      recordedNow(
        change('role_assigned', ada, 'admin'),
        invitedAs(toSam, 'editor'),
        revokedAs(toSam, 'editor', 'revoked'),
      ),
    );

    expect([
      decide(revoking(toNoor), withSamInvited()),
      decide(revoking(toSam), ended),
      decide(revoking(toSam, aMonthOn), withSamInvited()),
    ]).toEqual([Result.succeed([]), Result.succeed([]), Result.succeed([])]);
  });
});

describe('an invitation resent', () => {
  it('revokes the invitation pending and makes a new one in its role, thirty days from the resend, in one decision', () => {
    const later = '2026-11-20T09:00:00.000Z';

    expect(decide(resending(toSam, toNoor, later), withSamInvited())).toEqual(
      Result.succeed([revokedAs(toSam, 'editor', 'resent'), invitedAs(toNoor, 'editor', '2026-12-20T09:00:00.000Z')]),
    );
  });

  it('makes nothing where the invitation is no longer pending', () => {
    expect(decide(resending(toSam, toNoor, anHourAfterItsEnd), withSamInvited())).toEqual(Result.succeed([]));
  });
});

function removedWith(principal: typeof priya, invitations: readonly string[]): RolesDeprovisioned {
  return { kind: 'deprovision', source: 'manual', principal, scope: acme, ...acted, invitations };
}

const priyaInvitedTwice = () =>
  stateOf(
    recordedNow(
      change('role_assigned', ada, 'admin'),
      change('role_assigned', priya, 'viewer'),
      invitedAs(toSam, 'editor'),
      invitedAs(toNoor, 'viewer'),
      revokedAs(toNoor, 'viewer', 'revoked'),
    ),
  );

describe('the invitations pending to a member whose role an admin changes or ends', () => {
  it('are revoked in the same decision as the change, those still pending alone, for the reason of the change', () => {
    expect([
      decide({ ...given(ada, priya, 'editor'), invitations: [toSam, toNoor] }, priyaInvitedTwice()),
      decide(removedWith(priya, [toSam, toNoor]), priyaInvitedTwice()),
    ]).toEqual([
      Result.succeed([
        change('role_unassigned', priya, 'viewer'),
        change('role_assigned', priya, 'editor'),
        revokedAs(toSam, 'editor', 'role_changed'),
      ]),
      Result.succeed([change('role_unassigned', priya, 'viewer'), revokedAs(toSam, 'editor', 'member_removed')]),
    ]);
  });

  it('stay pending where nothing about the member changes, or the change is refused', () => {
    expect([
      decide({ ...given(ada, priya, 'viewer'), invitations: [toSam] }, priyaInvitedTwice()),
      decide(removedWith(dana, [toSam]), priyaInvitedTwice()),
      decide(removedWith(ada, [toSam]), priyaInvitedTwice()),
    ]).toEqual([
      Result.succeed([]),
      Result.succeed([]),
      Result.fail(new Conflict({ detail: lastAssigner, kind: 'unworkable' })),
    ]);
  });
});

describe('the invitations the decider folds', () => {
  it('are pending until they are accepted, revoked or past their end, and an ending of an invitation the stream never recorded changes nothing', () => {
    const folded = stateOf(
      recordedNow(
        invitedAs(toSam, 'editor'),
        invitedAs(toNoor, 'viewer', '2026-11-15T15:20:00.000Z'),
        revokedAs('an-invitation-never-made', 'viewer', 'revoked'),
      ),
    );
    const accepted = stateOf(recordedNow(invitedAs(toSam, 'editor'), acceptedAs(toSam, 'editor', priya)));

    expect(
      pendingInvitationsIn(folded, acted.at)
        .map(({ invitation }) => invitation)
        .toSorted(),
    ).toEqual([toSam, toNoor].toSorted());
    expect(pendingInvitationsIn(folded, '2026-11-16T00:00:00.000Z')).toEqual([
      { invitation: toSam, role: { type: 'built_in', id: 'editor' }, expiresAt: aMonthOn },
    ]);
    expect([hasEnded(folded, toSam), hasEnded(accepted, toSam), hasEnded(folded, 'an-invitation-never-made')]).toEqual([
      false,
      true,
      false,
    ]);
  });
});
