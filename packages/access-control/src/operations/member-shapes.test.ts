import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { EmailAddressField, InvitationField, InvitationMadeSchema, InvitedRoleField } from './member-shapes.ts';

const anInvitation = {
  id: '9b74c9897bac770ffc029102a200c5de1f8b7c1f3b6e1ad2f0d2b3e1c4a5f6e7',
  email_address: 'sam@example.com',
  role: 'editor',
  status: 'pending',
  invited_at: '2026-11-20T09:00:00.000Z',
  expires_at: '2026-12-20T09:00:00.000Z',
};

const isAnInvitationMade = Schema.is(InvitationMadeSchema);

const isAnAddress = Schema.is(EmailAddressField);

const isARoleInvited = Schema.is(InvitedRoleField);

const isAnInvitationsId = Schema.is(InvitationField);

describe('the shapes of the members operations', () => {
  it('answer an invitation the call that made it answers with its link, and one listed without it', () => {
    expect([
      isAnInvitationMade({ ...anInvitation, link: 'https://auto.example.com/invitations/kQ2_x-9' }),
      isAnInvitationMade(anInvitation),
    ]).toEqual([true, true]);
  });

  it('take an email address with an @ and a dot after it, at most 254 characters, an editor, an operator or a viewer invited, and an invitation’s id', () => {
    const addresses = [
      'sam@example.com',
      `${'s'.repeat(242)}@example.com`,
      'sam',
      'sam@example',
      `${'s'.repeat(243)}@example.com`,
    ];

    expect(addresses.map((address) => isAnAddress(address))).toEqual([true, true, false, false, false]);
    expect(['editor', 'operator', 'viewer', 'admin'].map((role) => isARoleInvited(role))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect([anInvitation.id, 'i'.repeat(65), 'an/id'].map((id) => isAnInvitationsId(id))).toEqual([true, false, false]);
  });
});
