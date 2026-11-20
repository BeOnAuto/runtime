import { roleRefusalDetail, tokenTypeRefusalDetail } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { ada, adasAgent, ciKey, dana, everyone, outputOf, priya, refusedAs } from './members-called.ts';
import { membersKeptInMemory, signOutsRecorded } from './members-kept-in-memory.ts';

const invalidInput: unknown = expect.objectContaining({ status: 'rejected', reason: 'invalid_input' });

describe('how people join, before an admin sets it', () => {
  it('reads as joining without an invitation, as a viewer, and is answered to anyone in the org', async () => {
    const members = membersKeptInMemory(everyone, signOutsRecorded().signedOut);
    await members.imported(['ada', 'admin'], ['priya', 'viewer']);

    expect([outputOf(await members.joining(priya)), outputOf(await members.joining(ciKey))]).toEqual([
      { enrolment: 'join_without_invitation', default_role: 'viewer' },
      { enrolment: 'join_without_invitation', default_role: 'viewer' },
    ]);
  });
});

describe('how people join, set by an admin with the role they join with', () => {
  it('decides how the next person who signs in joins, keeps the role where none is asked, and is answered as set', async () => {
    const members = membersKeptInMemory(everyone, signOutsRecorded().signedOut);
    await members.imported(['ada', 'admin']);

    const byInvitation = outputOf(await members.enrolmentSet(ada, { enrolment: 'invitation', default_role: 'editor' }));
    const refusedForNoInvitation = await members.signedIn('priya');
    const withoutOneAgain = outputOf(await members.enrolmentSet(ada, { enrolment: 'join_without_invitation' }));
    const joined = await members.signedIn('grace');

    expect([byInvitation, withoutOneAgain]).toEqual([
      { enrolment: 'invitation', default_role: 'editor' },
      { enrolment: 'join_without_invitation', default_role: 'editor' },
    ]);
    expect([refusedForNoInvitation, joined]).toEqual(['invitation_needed', 'enrolment']);
    expect(outputOf(await members.listed(ada))).toMatchObject({
      members: [{ id: 'ada' }, { id: 'grace', role: 'editor' }],
    });
  });
});

describe('how people join, set by anyone else or with a role it does not take', () => {
  it('is refused in the approved words to an editor and a viewer, to an agent and an API key, and for a role that is not editor or viewer', async () => {
    const members = membersKeptInMemory(everyone, signOutsRecorded().signedOut);
    await members.imported(['ada', 'admin'], ['priya', 'editor'], ['dana', 'viewer']);
    const byTheirRole = { ...refusedAs('forbidden', roleRefusalDetail), kind: 'permission_denied' };
    const notInStudio = { ...refusedAs('forbidden', tokenTypeRefusalDetail), kind: 'not_allowed_token_type' };
    const asked = { enrolment: 'invitation', default_role: 'editor' };

    expect([
      await members.enrolmentSet(priya, asked),
      await members.enrolmentSet(dana, asked),
      await members.enrolmentSet(adasAgent, asked),
      await members.enrolmentSet(ciKey, asked),
      await members.enrolmentSet(ada, { enrolment: 'join_without_invitation', default_role: 'admin' }),
      await members.enrolmentSet(ada, { enrolment: 'join_without_invitation', default_role: 'owner' }),
      await members.enrolmentSet(ada, { enrolment: 'automatic_invitation' }),
    ]).toEqual([byTheirRole, byTheirRole, notInStudio, notInStudio, invalidInput, invalidInput, invalidInput]);
    expect(outputOf(await members.joining(ada))).toEqual({
      enrolment: 'join_without_invitation',
      default_role: 'viewer',
    });
  });
});
