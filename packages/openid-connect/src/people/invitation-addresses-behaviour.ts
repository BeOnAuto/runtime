import { describe, expect, it } from 'vitest';

import type { InvitationAddresses } from './invitation-addresses.ts';

export interface InvitationAddressesEntry {
  readonly name: string;
  readonly rowsOf: () => Promise<InvitationAddresses>;
}

const invitedAt = Date.parse('2026-11-20T09:00:00Z');

const anHour = 3_600_000;

const toSam = '9b74c9897bac770ffc029102a200c5de1f8b7c1f3b6e1ad2f0d2b3e1c4a5f6e7';

const toNoor = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';

const toPriya = '83f8bacd8d76fa75e99f5c9f61599419c6647d9aebe50b453a89da169899d6e1';

export function invitationAddressesBehaviour({ name, rowsOf }: InvitationAddressesEntry): void {
  describe(`the addresses of invitations kept ${name}`, () => {
    it('keep each invitation’s address as typed, by the invitation’s id, the earliest invited first', async () => {
      const rows = await rowsOf();

      await rows.kept({ invitation: toNoor, emailAddress: 'Noor@Example.com', invitedAt: invitedAt + anHour });
      await rows.kept({ invitation: toSam, emailAddress: 'sam@example.com', invitedAt });

      expect(await rows.listed()).toEqual([
        { invitation: toSam, emailAddress: 'sam@example.com', invitedAt },
        { invitation: toNoor, emailAddress: 'Noor@Example.com', invitedAt: invitedAt + anHour },
      ]);
    });

    it('forget the addresses of the invitations named, and no other, nothing for none named or one never kept', async () => {
      const rows = await rowsOf();
      await Promise.all(
        [toSam, toNoor, toPriya].map((invitation) =>
          rows.kept({ invitation, emailAddress: 'a@example.com', invitedAt }),
        ),
      );

      await rows.forgotten([toSam, toPriya, 'an-invitation-never-kept']);
      await rows.forgotten([]);

      expect((await rows.listed()).map(({ invitation }) => invitation)).toEqual([toNoor]);
    });
  });
}
