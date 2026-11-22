import { describe, expect, it } from 'vitest';

import type { AccountLinks } from '../../account-linking/account-links.ts';

export interface AccountLinksEntry {
  readonly name: string;
  readonly linksOf: () => Promise<AccountLinks>;
}

const dana = { account: 'T-northwind', member: 'U-dana' };

const omar = { account: 'T-northwind', member: 'U-omar' };

const danaElsewhere = { account: 'T-southwind', member: 'U-dana' };

const ada = 'a3f1c0de';

const priya = '0c3de111';

const linkedAt = Date.parse('2026-11-21T09:00:00Z');

function startsBehaviour({ name, linksOf }: AccountLinksEntry): void {
  describe(`the link starts ${name}`, () => {
    it('find a start by its secret and by its member, and none by another', async () => {
      const links = await linksOf();
      await links.started({ ...dana, secret: 'secret-1' });

      expect([
        await links.startFound('secret-1'),
        await links.startOf(dana),
        await links.startFound('secret-2'),
        await links.startOf(omar),
        await links.startOf(danaElsewhere),
      ]).toEqual([{ ...dana, secret: 'secret-1' }, { ...dana, secret: 'secret-1' }, undefined, undefined, undefined]);
    });

    it('replace the older start of a member by a newer one, and leave every other member’s', async () => {
      const links = await linksOf();
      await links.started({ ...dana, secret: 'secret-1' });
      await links.started({ ...omar, secret: 'secret-2' });

      await links.started({ ...dana, secret: 'secret-3', person: ada });

      expect([await links.startFound('secret-1'), await links.startOf(dana), await links.startOf(omar)]).toEqual([
        undefined,
        { ...dana, secret: 'secret-3', person: ada },
        { ...omar, secret: 'secret-2' },
      ]);
    });

    it('end a start once, and not one that replaced it', async () => {
      const links = await linksOf();
      const first = { ...dana, secret: 'secret-1' };
      await links.started(first);

      const ended = [await links.startEnded(first), await links.startEnded(first)];
      await links.started({ ...dana, secret: 'secret-2' });

      expect([...ended, await links.startEnded(first), await links.startOf(dana)]).toEqual([
        true,
        false,
        false,
        { ...dana, secret: 'secret-2' },
      ]);
    });
  });
}

function linksBehaviour({ name, linksOf }: AccountLinksEntry): void {
  describe(`the account links ${name}`, () => {
    it('find the link of a member, a newer one replacing it, and none for another member', async () => {
      const links = await linksOf();
      await links.linked({ ...dana, person: ada, linkedAt });

      await links.linked({ ...dana, person: priya, linkedAt: linkedAt + 1 });

      expect([await links.linkOf(dana), await links.linkOf(omar), await links.linkOf(danaElsewhere)]).toEqual([
        { ...dana, person: priya, linkedAt: linkedAt + 1 },
        undefined,
        undefined,
      ]);
    });

    it('forget the links of a person and the starts they allowed, and nothing of anyone else', async () => {
      const links = await linksOf();
      await links.linked({ ...dana, person: ada, linkedAt });
      await links.linked({ ...danaElsewhere, person: ada, linkedAt });
      await links.linked({ ...omar, person: priya, linkedAt });
      await links.started({ ...dana, secret: 'code-of-ada', person: ada });
      await links.started({ ...omar, secret: 'a-link' });

      await links.personForgotten(ada);

      expect([
        await links.linkOf(dana),
        await links.linkOf(danaElsewhere),
        await links.linkOf(omar),
        await links.startOf(dana),
        await links.startOf(omar),
      ]).toEqual([
        undefined,
        undefined,
        { ...omar, person: priya, linkedAt },
        undefined,
        { ...omar, secret: 'a-link' },
      ]);
    });
  });
}

export function accountLinksBehaviour(entry: AccountLinksEntry): void {
  startsBehaviour(entry);
  linksBehaviour(entry);
}
