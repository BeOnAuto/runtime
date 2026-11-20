import { Forbidden, roleRefusalDetail, roleRefusalKind } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { roleAssignmentDecider } from '../assignments/role-assignment-decider.ts';
import type { AssignedPrincipal, Enrolment, RoleAssignmentEvent } from '../assignments/role-assignment-facts.ts';
import { enrolledAs } from '../assignments/sign-in-decisions.ts';
import type { DefaultRoleId } from '../roles/built-in-roles.ts';
import {
  acceptedAs,
  acted,
  ada,
  afterward,
  change,
  dana,
  enrolmentSetAs,
  enrolmentSetBy,
  held,
  invitedAs,
  priya,
  signingIn,
  toSam,
} from '../testing/role-assignment-states.ts';
import { joiningIn, startingDefaultRole } from './joining-decisions.ts';

const decide = roleAssignmentDecider.decide;

const org = held([ada, 'admin'], [priya, 'editor'], [dana, 'viewer']);

describe('how people join an org whose stream holds no setting of it', () => {
  it('reads as joining without an invitation, as a viewer, the starting default role', () => {
    expect(startingDefaultRole).toBe('viewer');
    expect([joiningIn(roleAssignmentDecider.initialState), joiningIn(org)]).toEqual([
      { enrolment: 'join_without_invitation', defaultRole: 'viewer' },
      { enrolment: 'join_without_invitation', defaultRole: 'viewer' },
    ]);
  });
});

const startingValues = { enrolment: 'join_without_invitation', role: 'viewer' } as const;

describe('how people join and the role they join with, set by an admin', () => {
  it('is one fact of both, with both as they were, read back from the stream, and no fact where neither changes', () => {
    const byInvitation = Result.getOrThrow(decide(enrolmentSetBy(ada, 'invitation'), org));
    const invited = afterward(org, byInvitation);
    const asEditors = Result.getOrThrow(decide(enrolmentSetBy(ada, 'join_without_invitation', 'editor'), invited));
    const editors = afterward(invited, asEditors);

    expect([byInvitation, asEditors]).toEqual([
      [enrolmentSetAs({ enrolment: 'invitation', role: 'viewer' }, startingValues)],
      [
        enrolmentSetAs(
          { enrolment: 'join_without_invitation', role: 'editor' },
          { enrolment: 'invitation', role: 'viewer' },
        ),
      ],
    ]);
    expect([joiningIn(invited), joiningIn(editors)]).toEqual([
      { enrolment: 'invitation', defaultRole: 'viewer' },
      { enrolment: 'join_without_invitation', defaultRole: 'editor' },
    ]);
    expect([
      decide(enrolmentSetBy(ada, 'join_without_invitation'), org),
      decide(enrolmentSetBy(ada, 'join_without_invitation', 'viewer'), org),
      decide(enrolmentSetBy(ada, 'join_without_invitation', 'editor'), editors),
      decide(enrolmentSetBy(ada, 'join_without_invitation'), editors),
    ]).toEqual(Array.from({ length: 4 }, () => Result.succeed([])));
  });

  it('changes the role alone where the way of joining stays, and keeps the role where none is asked', () => {
    const asEditors = Result.getOrThrow(decide(enrolmentSetBy(ada, 'join_without_invitation', 'editor'), org));
    const byInvitation = Result.getOrThrow(decide(enrolmentSetBy(ada, 'invitation'), afterward(org, asEditors)));

    expect([asEditors, byInvitation]).toEqual([
      [enrolmentSetAs({ enrolment: 'join_without_invitation', role: 'editor' }, startingValues)],
      [
        enrolmentSetAs(
          { enrolment: 'invitation', role: 'editor' },
          { enrolment: 'join_without_invitation', role: 'editor' },
        ),
      ],
    ]);
  });
});

describe('how people join, set by anyone but an admin', () => {
  it('is refused in the approved words to an editor, a viewer, a person who holds no role and a key, and records nothing', () => {
    const refused = Result.fail(new Forbidden({ detail: roleRefusalDetail, kind: roleRefusalKind }));
    const outsider = { type: 'person', id: 'user_noor' } as const;
    const aKey = { ...enrolmentSetBy(ada, 'invitation', 'editor'), actor: { type: 'key', id: 'ci' } } as const;

    expect([
      decide(enrolmentSetBy(priya, 'invitation'), org),
      decide(enrolmentSetBy(dana, 'join_without_invitation', 'editor'), org),
      decide(enrolmentSetBy(outsider, 'invitation', 'editor'), org),
      decide(aKey, org),
    ]).toEqual(Array.from({ length: 4 }, () => refused));
  });
});

const sam: AssignedPrincipal = { type: 'person', id: 'user_sam' };

const noor: AssignedPrincipal = { type: 'person', id: 'user_noor' };

function setTo(enrolment: Enrolment, role: DefaultRoleId): readonly RoleAssignmentEvent[] {
  return [enrolmentSetAs({ enrolment, role }, startingValues)];
}

const signingInNow: readonly (readonly [AssignedPrincipal, string | undefined])[] = [
  [dana, undefined],
  [sam, toSam],
  [noor, undefined],
  [priya, undefined],
];

const eachSetting = [
  ['join_without_invitation', 'viewer'],
  ['join_without_invitation', 'editor'],
  ['invitation', 'viewer'],
  ['invitation', 'editor'],
] as const;

describe('a person who signs in, under each way of joining and each default role', () => {
  it('becomes the admin where the org has none, whatever the setting', () => {
    expect(
      eachSetting.map(([enrolment, role]) => decide(signingIn(priya), afterward(held(), setTo(enrolment, role)))),
    ).toEqual(eachSetting.map(() => Result.succeed([change('role_assigned', priya, 'admin', 'bootstrap')])));
  });

  it('keeps the role they hold, takes the invitation they carry, stays out once removed, and otherwise joins with the default role, or is refused where people join by invitation', () => {
    const removedOnce = afterward(held([ada, 'admin'], [dana, 'editor'], [noor, 'viewer']), [
      change('role_unassigned', noor, 'viewer'),
      invitedAs(toSam, 'admin'),
    ]);
    const decidedUnder = ([enrolment, role]: (typeof eachSetting)[number]) => {
      const state = afterward(removedOnce, setTo(enrolment, role));
      return signingInNow.map(([principal, carried]) => [
        enrolledAs(state, principal, { invitation: carried, at: acted.at }),
        decide(signingIn(principal, carried), state),
      ]);
    };
    const theSameEachTime = [
      ['member', Result.succeed([])],
      [
        'invitation',
        Result.succeed([acceptedAs(toSam, 'admin', sam), change('role_assigned', sam, 'admin', 'invitation')]),
      ],
      ['removed', Result.succeed([])],
    ];

    expect(eachSetting.map((setting) => decidedUnder(setting))).toEqual([
      [...theSameEachTime, ['enrolment', Result.succeed([change('role_assigned', priya, 'viewer', 'enrolment')])]],
      [...theSameEachTime, ['enrolment', Result.succeed([change('role_assigned', priya, 'editor', 'enrolment')])]],
      [...theSameEachTime, ['invitation_needed', Result.succeed([])]],
      [...theSameEachTime, ['invitation_needed', Result.succeed([])]],
    ]);
  });
});
