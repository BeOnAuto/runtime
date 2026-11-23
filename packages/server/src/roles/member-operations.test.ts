import { roleRefusalDetail, tokenTypeRefusalDetail } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { decisionTableOf } from '../testing/access/decision-table.ts';
import { memberOperationsOf, noSuchMember } from './member-operations.ts';
import { ada, adasAgent, ciKey, everyone, listedOf, madeOf, outputOf, priya, refusedAs } from './members-called.ts';
import {
  addressesKeptInMemory,
  importedAt,
  membersKeptInMemory,
  peopleKept,
  publicUrl,
  signOutsRecorded,
} from './members-kept-in-memory.ts';

const theRegistrations = memberOperationsOf({
  people: peopleKept([]),
  invitations: addressesKeptInMemory(),
  signedOut: signOutsRecorded().signedOut,
  publicUrl,
}).map(({ registration }) => registration);

const routed = [
  ['list_members', 'query', { method: 'GET', path: '/members' }, ['org:read']],
  ['invite_member', 'command', { method: 'POST', path: '/members/invitations' }, ['org:write']],
  ['invite_admin', 'command', { method: 'POST', path: '/members/admin-invitations' }, ['org:write']],
  ['resend_invitation', 'command', { method: 'POST', path: '/members/invitations/{invitation}/resend' }, ['org:write']],
  ['revoke_invitation', 'command', { method: 'DELETE', path: '/members/invitations/{invitation}' }, ['org:write']],
  ['set_member_role', 'command', { method: 'PUT', path: '/members/{member}/role' }, ['org:write']],
  ['remove_member', 'command', { method: 'DELETE', path: '/members/{member}' }, ['org:write']],
  ['get_enrolment', 'query', { method: 'GET', path: '/enrolment' }, ['org:read']],
  ['set_enrolment', 'command', { method: 'PUT', path: '/enrolment' }, ['org:write']],
];

describe('the members operations of a server that signs people in', () => {
  it('list the members and invite one as an agent’s tools, and make the other changes over HTTP alone, declaring that they manage permissions', () => {
    expect(theRegistrations.map(({ name, kind, route, permissions }) => [name, kind, route, permissions])).toEqual(
      routed,
    );
    expect(theRegistrations.map((registration) => 'servedOverHttpAlone' in registration)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(theRegistrations.map(({ permissionsManagement }) => permissionsManagement)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      false,
      true,
    ]);
  });
});

const listedCounting = (members: number, invitations: number) => ({
  members: [],
  members_total: members,
  invitations: [],
  invitations_total: invitations,
});

describe('what list_members says to an agent', () => {
  it('is in words of their own for each count of members and of invitations', () => {
    const listing = theRegistrations.find(({ name }) => name === 'list_members')?.plainLanguage;
    const words = [
      listing?.attempt({}),
      listing?.outcome(listedCounting(0, 0), {}),
      listing?.outcome(listedCounting(1, 1), {}),
      listing?.outcome(listedCounting(2, 3), {}),
    ];

    expect(new Set(words).size).toBe(4);
  });
});

const listing = ['org/list_members', 'org/get_enrolment'];

const inviting = ['org/invite_member'];

const changing = [
  'org/invite_admin',
  'org/resend_invitation',
  'org/revoke_invitation',
  'org/set_member_role',
  'org/remove_member',
  'org/set_enrolment',
];

const servedOrder = theRegistrations.map(({ name }) => `org/${name}`);

function inServedOrder(...groups: readonly (readonly string[])[]): readonly string[] {
  return groups.flat().toSorted((one, other) => servedOrder.indexOf(one) - servedOrder.indexOf(other));
}

const atTheirServer = (role: string) => `${role}, in Studio at their company’s server, holding every permission`;

const allowedAndRefused = [
  ['Admin, in Studio', inServedOrder(listing, inviting, changing), [], []],
  ['Admin, through their connected agent', inServedOrder(listing, inviting), [], changing],
  ['Admin, asking @Auto in Slack', inServedOrder(listing, inviting), [], changing],
  ['Admin, in a run they started', inServedOrder(listing, inviting), [], []],
  ['Editor, in Studio', inServedOrder(listing, inviting), changing, []],
  ['Editor, through their connected agent', inServedOrder(listing, inviting), changing, []],
  ['Editor, asking @Auto in Slack', inServedOrder(listing, inviting), changing, []],
  ['Editor, in a run they started', inServedOrder(listing, inviting), [], []],
  ['Editor, through an agent they approved to read', listing, changing, []],
  [atTheirServer('Editor'), inServedOrder(listing, inviting), changing, []],
  ['Operator, in Studio', listing, inServedOrder(inviting, changing), []],
  ['Operator, through their connected agent', listing, inServedOrder(inviting, changing), []],
  ['Operator, asking @Auto in Slack', listing, inServedOrder(inviting, changing), []],
  ['Operator, in a run they started', inServedOrder(listing, inviting), [], []],
  ['Operator, through an agent they approved to read', listing, inServedOrder(inviting, changing), []],
  [atTheirServer('Operator'), listing, inServedOrder(inviting, changing), []],
  ['Viewer, in Studio', listing, inServedOrder(inviting, changing), []],
  ['Viewer, through their connected agent', listing, inServedOrder(inviting, changing), []],
  ['Viewer, asking @Auto in Slack', listing, inServedOrder(inviting, changing), []],
  ['Viewer, in a run they started', inServedOrder(listing, inviting), [], []],
  ['A person with no role, in Studio', [], inServedOrder(listing, inviting, changing), []],
  ['An Editor of another org, in Studio', [], inServedOrder(listing, inviting, changing), []],
  ['An API key', inServedOrder(listing, inviting), [], changing],
  ['An API key that reads', listing, [], changing],
  ['An API key that runs', listing, [], changing],
  ['Playbook alpha, in a run a trigger or a schedule started', [], [], []],
  ['The local developer', inServedOrder(listing, inviting), [], changing],
];

describe('the members operations, decided for each role and each kind of caller by the decision point the server loads', () => {
  it('let anyone in the org list them, invite where a role may write the org, and an admin in Studio alone make the other changes', async () => {
    const table = await decisionTableOf(theRegistrations);

    expect(
      table.map(({ caller, allowed, refusedForTheRole, refusedForTheTokenType }) => [
        caller,
        allowed,
        refusedForTheRole,
        refusedForTheTokenType,
      ]),
    ).toEqual(allowedAndRefused);
    expect([
      table.flatMap(({ decidedOtherwise }) => decidedOtherwise),
      table.flatMap(({ enforcedOtherwise }) => enforcedOtherwise),
    ]).toEqual([[], []]);
  });
});

describe('list_members', () => {
  it('lists each person who holds a role in the org, by their record where they signed in, the earliest to join first', async () => {
    const members = membersKeptInMemory(everyone, signOutsRecorded().signedOut);
    await members.imported(['priya', 'viewer'], ['ada', 'admin'], ['dana', 'editor'], ['grace', 'editor']);
    await members.ended('grace', 'manual');

    expect(outputOf(await members.listed(priya))).toMatchObject({
      members: [
        { id: 'dana', name: null, identifier: null, role: 'editor', joined_at: importedAt },
        { id: 'ada', name: 'Ada Lovelace', identifier: 'ada@example.com', joined_at: '2026-11-18T09:00:00.000Z' },
        { id: 'priya', identifier: 'Priya@Example.com', role: 'viewer', joined_at: '2026-11-18T10:00:00.000Z' },
      ],
      members_total: 3,
    });
  });

  it('lists 500 members at most, and counts them all', async () => {
    const members = membersKeptInMemory([], signOutsRecorded().signedOut);
    await members.imported(...Array.from({ length: 501 }, (_, at) => [`person-${String(at)}`, 'viewer'] as const));

    const listed = listedOf(await members.listed(priya));

    expect([listed.members.length, listed.members_total]).toEqual([500, 501]);
  });
});

describe('set_member_role', () => {
  it('gives a member another role, and a holder who never signed in another, and answers each in it', async () => {
    const members = membersKeptInMemory(everyone, signOutsRecorded().signedOut);
    await members.imported(['ada', 'admin'], ['priya', 'viewer'], ['dana', 'viewer']);

    const given = [await members.roleSet(ada, 'priya', 'editor'), await members.roleSet(ada, 'dana', 'admin')];

    expect(given.map((outcome) => outputOf(outcome))).toEqual([
      {
        id: 'priya',
        name: null,
        identifier: 'Priya@Example.com',
        role: 'editor',
        joined_at: '2026-11-18T10:00:00.000Z',
      },
      { id: 'dana', name: null, identifier: null, role: 'admin', joined_at: importedAt },
    ]);
  });

  it('revokes the invitations pending to the member’s address, in any case, with the change', async () => {
    const members = membersKeptInMemory(everyone, signOutsRecorded().signedOut);
    await members.imported(['ada', 'admin']);
    const toPriya = madeOf(await members.invitedAnAdmin(ada, 'PRIYA@example.com'));
    await members.signedIn('priya');

    await members.roleSet(ada, 'priya', 'editor');

    expect(listedOf(await members.listed(ada)).invitations).toEqual([]);
    expect(await members.signedIn('sam', toPriya.link)).toBe('enrolment');
  });
});

const unworkable: unknown = expect.objectContaining({ status: 'rejected', reason: 'conflict', kind: 'unworkable' });

describe('set_member_role refused', () => {
  it('for someone the org does not know or removed, in the approved words to a person whose role gives no role and to anyone outside Studio, and to leave no admin', async () => {
    const members = membersKeptInMemory(everyone, signOutsRecorded().signedOut);
    await members.imported(['ada', 'admin'], ['priya', 'viewer'], ['grace', 'editor']);
    await members.ended('grace', 'manual');
    const notInStudio = { ...refusedAs('forbidden', tokenTypeRefusalDetail), kind: 'not_allowed_token_type' };

    expect([
      await members.roleSet(ada, 'someone-never-seen', 'viewer'),
      await members.roleSet(ada, 'grace', 'viewer'),
      await members.roleSet(priya, 'ada', 'viewer'),
      await members.roleSet(adasAgent, 'priya', 'editor'),
      await members.roleSet(ciKey, 'priya', 'editor'),
      await members.roleSet(ada, 'ada', 'editor'),
    ]).toEqual([
      refusedAs('not_found', noSuchMember),
      refusedAs('not_found', noSuchMember),
      { ...refusedAs('forbidden', roleRefusalDetail), kind: 'permission_denied' },
      notInStudio,
      notInStudio,
      unworkable,
    ]);
  });
});

describe('remove_member', () => {
  it('ends the role a member holds, the invitations pending to their address and their sign-ins, and answers them as they were', async () => {
    const signOuts = signOutsRecorded();
    const members = membersKeptInMemory(everyone, signOuts.signedOut);
    await members.imported(['ada', 'admin'], ['dana', 'viewer']);
    const toPriya = madeOf(await members.invited(ada, { email_address: 'priya@EXAMPLE.com' }));
    await members.signedIn('priya');

    const removed = [await members.removed(ada, 'priya'), await members.removed(ada, 'dana')];

    expect(removed.map((outcome) => outputOf(outcome))).toMatchObject([
      { id: 'priya', identifier: 'Priya@Example.com', role: 'viewer', joined_at: '2026-11-18T10:00:00.000Z' },
      { id: 'dana', name: null, identifier: null, role: 'viewer', joined_at: importedAt },
    ]);
    expect(signOuts.ended()).toEqual(['priya', 'dana']);
    expect(outputOf(await members.listed(ada))).toMatchObject({ members: [{ id: 'ada' }], invitations: [] });
    expect(await members.signedIn('priya', toPriya.link)).toBe('removed');
  });

  it('lets a removed person come back by a new invitation, and by no other way', async () => {
    const members = membersKeptInMemory(everyone, signOutsRecorded().signedOut);
    await members.imported(['ada', 'admin'], ['priya', 'editor']);
    await members.removed(ada, 'priya');
    const again = madeOf(await members.invited(ada, { email_address: 'priya@example.com', role: 'viewer' }));

    expect([await members.signedIn('priya'), await members.signedIn('priya', again.link)]).toEqual([
      'removed',
      'invitation',
    ]);
    expect(outputOf(await members.listed(ada))).toMatchObject({
      members: [{ id: 'ada' }, { id: 'priya', role: 'viewer' }],
    });
  });
});

describe('remove_member refused', () => {
  it('for someone who holds no role, a removed person among them, and for the org’s last admin, signing no one out', async () => {
    const signOuts = signOutsRecorded();
    const members = membersKeptInMemory(everyone, signOuts.signedOut);
    await members.imported(['ada', 'admin'], ['grace', 'viewer']);
    await members.ended('grace', 'manual');

    expect([
      await members.removed(ada, 'grace'),
      await members.removed(ada, 'someone-never-seen'),
      await members.removed(ada, 'ada'),
    ]).toEqual([refusedAs('not_found', noSuchMember), refusedAs('not_found', noSuchMember), unworkable]);
    expect(signOuts.ended()).toEqual([]);
  });

  it('answers the removal where the member’s sign-ins could not be ended, since their role has ended', async () => {
    const members = membersKeptInMemory(everyone, () => Promise.reject(new Error('The rows cannot be written')));
    await members.imported(['ada', 'admin'], ['priya', 'viewer']);

    const removed = await members.removed(ada, 'priya');

    expect(outputOf(removed)).toMatchObject({ id: 'priya', role: 'viewer' });
    expect(await members.signedIn('priya')).toBe('removed');
  });
});
