import { statement, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';

import type { AuthDatabase } from '../store/auth-database.ts';
import type { InvitationAddresses } from './invitation-addresses.ts';

export const invitationAddressesTable = 'auth_invitations';

export const invitationAddressesTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS auth_invitations (
    invitation TEXT NOT NULL PRIMARY KEY,
    email_address TEXT NOT NULL,
    invited_at BIGINT NOT NULL
  )`,
];

const decodeRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      invitation: Schema.String,
      email_address: Schema.String,
      invited_at: Schema.Union([Schema.Finite, Schema.FiniteFromString]),
    }),
  ),
);

export function storedInvitationAddresses(database: AuthDatabase): InvitationAddresses {
  return {
    kept: async ({ invitation, emailAddress, invitedAt }) => {
      await database.write(statement`INSERT INTO auth_invitations (invitation, email_address, invited_at)
        VALUES (${invitation}, ${emailAddress}, ${invitedAt})`);
    },
    listed: async () =>
      decodeRows(
        await database.read(statement`SELECT invitation, email_address, invited_at
          FROM auth_invitations ORDER BY invited_at, invitation`),
      ).map(({ invitation, email_address, invited_at }) => ({
        invitation,
        emailAddress: email_address,
        invitedAt: invited_at,
      })),
    forgotten: async (invitations) => {
      await Promise.all(
        invitations.map((invitation) =>
          database.write(statement`DELETE FROM auth_invitations WHERE invitation = ${invitation}`),
        ),
      );
    },
  };
}
