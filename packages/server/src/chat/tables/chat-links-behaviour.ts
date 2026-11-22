import { describe, expect, it } from 'vitest';

import type { ChatRowsEntry } from './chat-rows-behaviour.ts';
import type { ChatRows, LinksSelected, MemberOfAnAccount } from './chat-rows.ts';

const first: MemberOfAnAccount = { account: 'account-1', member: 'member-1' };

const second: MemberOfAnAccount = { account: 'account-1', member: 'member-2' };

const firstElsewhere: MemberOfAnAccount = { account: 'account-2', member: 'member-1' };

const linkedAt = Date.parse('2026-11-21T09:00:00Z');

function startsBehaviour({ name, rowsOf }: ChatRowsEntry): void {
  describe(`the link starts ${name}`, () => {
    it('find a start by its secret and by its member, and none by another', async () => {
      const { links } = await rowsOf();
      await links.started({ ...first, secret: 'secret-1' });

      expect([
        await links.startFound('secret-1'),
        await links.startOf(first),
        await links.startFound('secret-2'),
        await links.startOf(second),
        await links.startOf(firstElsewhere),
      ]).toStrictEqual([
        { ...first, secret: 'secret-1' },
        { ...first, secret: 'secret-1' },
        undefined,
        undefined,
        undefined,
      ]);
    });

    it('replace the start of a member by a newer one, and leave every other member’s', async () => {
      const { links } = await rowsOf();
      await links.started({ ...first, secret: 'secret-1' });
      await links.started({ ...second, secret: 'secret-2' });

      await links.started({ ...first, secret: 'secret-3', person: 'person-1' });

      expect([
        await links.startFound('secret-1'),
        await links.startOf(first),
        await links.startOf(second),
      ]).toStrictEqual([
        undefined,
        { ...first, secret: 'secret-3', person: 'person-1' },
        { ...second, secret: 'secret-2' },
      ]);
    });
  });
}

function endingBehaviour({ name, rowsOf }: ChatRowsEntry): void {
  describe(`the link starts ${name}, ended or shared`, () => {
    it('end a start once, and never one that replaced it', async () => {
      const { links } = await rowsOf();
      const started = { ...first, secret: 'secret-1' };
      await links.started(started);

      const ended = [await links.startEnded(started), await links.startEnded(started)];
      await links.started({ ...first, secret: 'secret-2' });

      expect([...ended, await links.startEnded(started), await links.startOf(first)]).toStrictEqual([
        true,
        false,
        false,
        { ...first, secret: 'secret-2' },
      ]);
    });

    it('find the start of the first member, by account and member, where two starts hold one secret', async () => {
      const { links } = await rowsOf();
      await links.started({ ...second, secret: 'secret-1' });
      await links.started({ ...first, secret: 'secret-1' });

      expect(await links.startFound('secret-1')).toStrictEqual({ ...first, secret: 'secret-1' });
    });
  });
}

function linksBehaviour({ name, rowsOf }: ChatRowsEntry): void {
  describe(`the links ${name}`, () => {
    it('find the link of a member, a newer one replacing it, and none of another member', async () => {
      const { links } = await rowsOf();
      await links.linked({ ...first, person: 'person-1', linkedAt });

      await links.linked({ ...first, person: 'person-2', linkedAt: linkedAt + 1 });

      expect([await links.linkOf(first), await links.linkOf(second), await links.linkOf(firstElsewhere)]).toStrictEqual(
        [{ ...first, person: 'person-2', linkedAt: linkedAt + 1 }, undefined, undefined],
      );
    });

    it('forget the links of a person and the starts they allowed, and nothing of anyone else', async () => {
      const { links } = await rowsOf();
      await links.linked({ ...first, person: 'person-1', linkedAt });
      await links.linked({ ...firstElsewhere, person: 'person-1', linkedAt });
      await links.linked({ ...second, person: 'person-2', linkedAt });
      await links.started({ ...first, secret: 'code-allowed-by-person-1', person: 'person-1' });
      await links.started({ ...second, secret: 'an-open-link' });

      await links.personForgotten('person-1');

      expect([
        await links.linkOf(first),
        await links.linkOf(firstElsewhere),
        await links.linkOf(second),
        await links.startOf(first),
        await links.startOf(second),
      ]).toStrictEqual([
        undefined,
        undefined,
        { ...second, person: 'person-2', linkedAt },
        undefined,
        { ...second, secret: 'an-open-link' },
      ]);
    });
  });
}

interface Linking extends MemberOfAnAccount {
  readonly person: string;
}

const three: readonly Linking[] = [
  { ...first, person: 'person-1' },
  { ...second, person: 'person-2' },
  { ...firstElsewhere, person: 'person-1' },
];

async function linkedAndStarted(rows: ChatRows, { person, ...member }: Linking): Promise<void> {
  await rows.links.linked({ ...member, person, linkedAt });
  await rows.links.started({ ...member, secret: `code-of-${member.account}-${member.member}`, person });
}

const kept = (rows: ChatRows, of: 'linkOf' | 'startOf') =>
  Promise.all(three.map(async (each) => (await rows.links[of](each)) !== undefined));

function deletionsBehaviour({ name, rowsOf }: ChatRowsEntry): void {
  describe(`the links and link starts ${name}, deleted`, () => {
    it.each<readonly [string, LinksSelected, readonly boolean[]]>([
      ['of an account', { account: 'account-1' }, [false, false, true]],
      ['of a member in an account', first, [false, true, true]],
      ['of a person', { person: 'person-1' }, [false, true, false]],
      ['of nobody kept', { person: 'person-9' }, [true, true, true]],
    ])('go %s, and no other', async (_case, selected, left) => {
      const rows = await rowsOf();
      await three.reduce(async (before: Promise<void>, linking) => {
        await before;
        await linkedAndStarted(rows, linking);
      }, Promise.resolve());

      const deleted = [await rows.links.linksDeleted(selected), await rows.links.startsDeleted(selected)];

      expect(deleted).toEqual([left.includes(false), left.includes(false)]);
      expect([await kept(rows, 'linkOf'), await kept(rows, 'startOf')]).toEqual([left, left]);
    });
  });
}

export function chatLinksBehaviour(entry: ChatRowsEntry): void {
  startsBehaviour(entry);
  endingBehaviour(entry);
  linksBehaviour(entry);
  deletionsBehaviour(entry);
}
