import { createHash } from 'node:crypto';

import { explanationOf, roleRefusalDetail } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { addressTaken, invitationOperationsOf, noPerson, noSuchInvitation } from './invitation-operations.ts';
import {
  aMonthOn,
  ada,
  alpha,
  ciKey,
  dana,
  danasAgent,
  everyone,
  listedOf,
  longAgo,
  madeOf,
  outputOf,
  priya,
  refusedAs,
} from './members-called.ts';
import {
  addressesKeptInMemory,
  askedAt,
  membersKeptInMemory,
  peopleKept,
  publicUrl,
  signOutsRecorded,
} from './members-kept-in-memory.ts';

const anAdminAnd = async (...others: readonly (readonly [string, 'editor' | 'viewer'])[]) => {
  const members = membersKeptInMemory(everyone, signOutsRecorded().signedOut);
  await members.imported(['ada', 'admin'], ...others);
  return members;
};

const addressesListed = async (members: Readonly<Awaited<ReturnType<typeof anAdminAnd>>>, at = askedAt) =>
  listedOf(await members.listed(priya, at)).invitations.map(({ email_address }) => email_address);

const notFound = refusedAs('not_found', noSuchInvitation);

const aLink: unknown = expect.stringMatching(/^https:\/\/auto\.example\.test\/invitations\/[\w-]{43}$/u);

const anInvitationMade = {
  id: '9b74c9897bac770ffc029102a200c5de1f8b7c1f3b6e1ad2f0d2b3e1c4a5f6e7',
  email_address: 'sam@example.com',
  role: 'editor',
  status: 'pending',
  invited_at: askedAt,
  expires_at: aMonthOn,
  link: `${publicUrl}/invitations/kQ2_x-9`,
};

describe('what invite_member says to an agent', () => {
  const kept = { people: peopleKept([]), invitations: addressesKeptInMemory(), publicUrl };
  const [inviting] = invitationOperationsOf({ ...kept, signedOut: signOutsRecorded().signedOut });
  const words = inviting.registration.plainLanguage;

  it('is in words of their own for each role', () => {
    const asked = { email_address: 'sam@example.com' };

    expect(
      new Set([
        words?.attempt(asked),
        words?.outcome(anInvitationMade, asked),
        words?.outcome(anInvitationMade, { ...asked, role: 'viewer' }),
      ]).size,
    ).toBe(3);
  });

  it('explains an address in use by the explanation it declares, not by that of a name that is taken', () => {
    const addressInUse = { reason: 'conflict', kind: 'taken' } as const;
    const declared = words?.explanations?.taken;

    expect(declared).toBeDefined();
    expect(explanationOf(addressInUse, {}, words?.explanations)).toBe(declared);
    expect(declared).not.toEqual(explanationOf(addressInUse));
  });
});

describe('invite_member', () => {
  it('invites a person as an editor, or as the role asked, and answers the invitation with its link once, a secret at the server’s address whose SHA-256 is the invitation’s id', async () => {
    const members = await anAdminAnd(['dana', 'editor']);

    const asAnEditor = await members.invited(danasAgent, { email_address: 'sam@example.com' });
    const asAViewer = await members.invited(dana, { email_address: 'noor@example.com', role: 'viewer' });
    const made = madeOf(asAnEditor);

    expect(outputOf(asAnEditor)).toEqual({
      id: made.id,
      email_address: 'sam@example.com',
      role: 'editor',
      status: 'pending',
      invited_at: askedAt,
      expires_at: aMonthOn,
      link: aLink,
    });
    expect(made.id).toBe(
      createHash('sha256')
        .update(made.link.slice(made.link.lastIndexOf('/') + 1))
        .digest('hex'),
    );
    expect(outputOf(asAViewer)).toMatchObject({ role: 'viewer' });
    expect((await members.addresses.listed()).map(({ emailAddress }) => emailAddress)).toEqual([
      'sam@example.com',
      'noor@example.com',
    ]);
  });
});

describe('invite_member refused', () => {
  it('for an address of a member or of a pending invitation, in any case, and not for one whose invitation ended or whose person was removed', async () => {
    const members = await anAdminAnd(['priya', 'viewer'], ['grace', 'viewer']);
    await members.removed(ada, 'grace');
    await members.invited(ada, { email_address: 'sam@example.com' }, longAgo);
    await members.invited(ada, { email_address: 'noor@example.com' });
    const taken = { ...refusedAs('conflict', addressTaken), kind: 'taken' };

    expect([
      await members.invited(ada, { email_address: 'priya@example.com' }),
      await members.invited(ada, { email_address: 'NOOR@example.com' }),
    ]).toEqual([taken, taken]);
    expect([
      outputOf(await members.invited(ada, { email_address: 'sam@example.com' })),
      outputOf(await members.invited(ada, { email_address: 'grace@example.com' })),
    ]).toMatchObject([{ email_address: 'sam@example.com' }, { email_address: 'grace@example.com' }]);
  });

  it('to a caller who is no person, an API key and a playbook, and in the approved words to a person whose role may not invite, recording nothing', async () => {
    const members = await anAdminAnd(['priya', 'viewer']);
    const asked = { email_address: 'sam@example.com' };

    expect([
      await members.invited(ciKey, asked),
      await members.invited(alpha, asked),
      await members.invited(priya, asked),
    ]).toEqual([
      refusedAs('forbidden', noPerson),
      refusedAs('forbidden', noPerson),
      { ...refusedAs('forbidden', roleRefusalDetail), kind: 'permission_denied' },
    ]);
    expect(await addressesListed(members)).toEqual([]);
  });
});

describe('invite_admin', () => {
  it('invites a person as an admin, an admin’s invitation alone, and refuses an editor’s in the approved words', async () => {
    const members = await anAdminAnd(['dana', 'editor']);

    expect([
      outputOf(await members.invitedAnAdmin(ada, 'sam@example.com')),
      await members.invitedAnAdmin(dana, 'noor@example.com'),
    ]).toMatchObject([
      { email_address: 'sam@example.com', role: 'admin', link: aLink },
      { status: 'rejected', reason: 'forbidden', detail: roleRefusalDetail },
    ]);
  });
});

describe('the invitations list_members answers', () => {
  it('are those pending, the earliest first, each until thirty days after it was made', async () => {
    const members = await anAdminAnd(['dana', 'editor']);
    await members.invited(ada, { email_address: 'sam@example.com' });
    await members.invited(dana, { email_address: 'noor@example.com', role: 'viewer' }, '2026-11-19T17:00:00.000Z');

    expect(outputOf(await members.listed(priya, '2026-11-19T18:00:00.000Z'))).toMatchObject({
      invitations: [
        {
          email_address: 'sam@example.com',
          role: 'editor',
          status: 'pending',
          invited_at: askedAt,
          expires_at: aMonthOn,
        },
        { email_address: 'noor@example.com', role: 'viewer', expires_at: '2026-12-19T17:00:00.000Z' },
      ],
      invitations_total: 2,
    });
    expect([
      await addressesListed(members, '2026-12-19T15:59:59.999Z'),
      await addressesListed(members, aMonthOn),
    ]).toEqual([['sam@example.com', 'noor@example.com'], ['noor@example.com']]);
  });
});

describe('a person who signs in carrying an invitation', () => {
  it('joins in its role, and the invitation is no longer pending', async () => {
    const members = await anAdminAnd();
    const made = madeOf(await members.invited(ada, { email_address: 'priya@example.com' }));

    expect(await members.signedIn('priya', made.link)).toBe('invitation');
    expect(outputOf(await members.listed(priya))).toMatchObject({
      members: [{ id: 'ada' }, { id: 'priya', role: 'editor' }],
      invitations: [],
    });
  });
});

describe('resend_invitation', () => {
  it('replaces an invitation pending with a new one to the same address in the same role, with a new link, and the earlier link stops working', async () => {
    const members = await anAdminAnd();
    const first = madeOf(await members.invited(ada, { email_address: 'sam@example.com', role: 'viewer' }));
    const later = '2026-11-20T09:00:00.000Z';

    const resent = await members.resent(ada, first.id, later);
    const replacement = madeOf(resent);

    expect(outputOf(resent)).toMatchObject({
      email_address: 'sam@example.com',
      role: 'viewer',
      invited_at: later,
      expires_at: '2026-12-20T09:00:00.000Z',
    });
    expect([replacement.id === first.id, replacement.link === first.link]).toEqual([false, false]);
    expect(listedOf(await members.listed(ada, later)).invitations.map(({ id }) => id)).toEqual([replacement.id]);
    expect((await members.addresses.listed()).map(({ invitation }) => invitation)).toEqual([replacement.id]);
    expect(await members.signedIn('sam', first.link, later)).toBe('enrolment');
  });

  it('is refused for an invitation past its end, one revoked, and one never made', async () => {
    const members = await anAdminAnd();
    const revoked = madeOf(await members.invited(ada, { email_address: 'sam@example.com' }));
    const expired = madeOf(await members.invited(ada, { email_address: 'noor@example.com' }, longAgo));

    const pastItsEnd = await members.resent(ada, expired.id);
    await members.revoked(ada, revoked.id);

    expect([pastItsEnd, await members.resent(ada, revoked.id), await members.resent(ada, 'never-made')]).toEqual([
      notFound,
      notFound,
      notFound,
    ]);
  });
});

describe('revoke_invitation', () => {
  it('revokes an invitation pending and answers it revoked, so its link brings nobody in, and forgets its address', async () => {
    const members = await anAdminAnd();
    const made = madeOf(await members.invited(ada, { email_address: 'sam@example.com' }));

    expect(outputOf(await members.revoked(ada, made.id))).toEqual({
      id: made.id,
      email_address: 'sam@example.com',
      role: 'editor',
      status: 'revoked',
      invited_at: askedAt,
      expires_at: aMonthOn,
    });
    expect([await addressesListed(members), await members.addresses.listed()]).toEqual([[], []]);
    expect(await members.signedIn('sam', made.link)).toBe('enrolment');
  });

  it('is refused for an invitation past its end, one never made, and one revoked already', async () => {
    const members = await anAdminAnd();
    const made = madeOf(await members.invited(ada, { email_address: 'sam@example.com' }));
    const pastItsEnd = madeOf(await members.invited(ada, { email_address: 'noor@example.com' }, longAgo));

    const refused = [await members.revoked(ada, pastItsEnd.id), await members.revoked(ada, 'never-made')];
    await members.revoked(ada, made.id);

    expect([...refused, await members.revoked(ada, made.id)]).toEqual([notFound, notFound, notFound]);
  });
});

describe('the addresses of invitations', () => {
  it('are forgotten by the next change once their invitation ended or thirty days after they were kept, and a change stands where they could not be', async () => {
    const addresses = addressesKeptInMemory();
    const members = membersKeptInMemory(everyone, signOutsRecorded().signedOut, addresses);
    await members.imported(['ada', 'admin']);
    await addresses.kept({
      invitation: 'never-recorded',
      emailAddress: 'lee@example.com',
      invitedAt: Date.parse(askedAt),
    });
    await members.invited(ada, { email_address: 'old@example.com' }, longAgo);
    await members.invited(ada, { email_address: 'sam@example.com' });

    const kept = (await addresses.listed()).map(({ emailAddress }) => emailAddress);
    addresses.failing();

    expect(kept).toEqual(['lee@example.com', 'sam@example.com']);
    expect(outputOf(await members.invited(ada, { email_address: 'noor@example.com' }))).toMatchObject({
      email_address: 'noor@example.com',
      link: aLink,
    });
  });
});

describe('an invitation pending whose address is not kept', () => {
  it('is left out of the listing, which answers an address with every invitation it lists', async () => {
    const addresses = addressesKeptInMemory();
    const members = membersKeptInMemory(everyone, signOutsRecorded().signedOut, addresses);
    await members.imported(['ada', 'admin']);
    const made = madeOf(await members.invited(ada, { email_address: 'sam@example.com' }));

    await addresses.forgotten([made.id]);

    expect(listedOf(await members.listed(ada)).invitations).toEqual([]);
  });
});
