import { describe, expect, it } from 'vitest';

import { accountLinksInMemory, keyedHashOf } from '../testing/account-linking/account-links-in-memory.ts';
import { aCodeShownTo, ada, at, dana, hashed, omar, publicUrl } from '../testing/account-linking/linking-fixtures.ts';
import { codeHandedBack, linkStarted, type CodeHandedBack } from './account-linking.ts';
import type { AccountLinks, MemberOfAnAccount } from './account-links.ts';

type Sending = (links: AccountLinks, code: string) => Promise<readonly CodeHandedBack[]>;

const handedBackBy = (links: AccountLinks, member: MemberOfAnAccount, text: string) =>
  codeHandedBack({ links, hashed }, member, text, at);

const sentBy: ReadonlyArray<readonly [string, Sending, readonly CodeHandedBack[], unknown]> = [
  [
    'the member it was made for',
    async (links, code) => [await handedBackBy(links, dana, code)],
    [{ linked: ada }],
    { ...dana, person: ada, linkedAt: at },
  ],
  [
    'the member it was made for, in small letters and with spaces around it',
    async (links, code) => [await handedBackBy(links, dana, ` ${code.toLowerCase()} `)],
    [{ linked: ada }],
    { ...dana, person: ada, linkedAt: at },
  ],
  [
    'another member, which ends it',
    async (links, code) => [await handedBackBy(links, omar, code), await handedBackBy(links, dana, code)],
    [{ refused: 'another_member' }, { awaited: false }],
    undefined,
  ],
  [
    'the member it was made for, a second time',
    async (links, code) => [await handedBackBy(links, dana, code), await handedBackBy(links, dana, code)],
    [{ linked: ada }, { awaited: false }],
    { ...dana, person: ada, linkedAt: at },
  ],
  [
    'the member it was made for, once a newer link replaced it',
    async (links, code) => {
      await linkStarted(links, publicUrl, dana);
      return [await handedBackBy(links, dana, code)];
    },
    [{ awaited: false }],
    undefined,
  ],
  [
    'the member it was made for, after one wrong code, which ends it',
    async (links, code) => [await handedBackBy(links, dana, 'ZZZZZZ'), await handedBackBy(links, dana, code)],
    [{ refused: 'wrong_code' }, { awaited: false }],
    undefined,
  ],
  [
    'the member it was made for, held under another key, which is a wrong code and ends it',
    async (links, code) => [
      await codeHandedBack({ links, hashed: keyedHashOf(2) }, dana, code, at),
      await handedBackBy(links, dana, code),
    ],
    [{ refused: 'wrong_code' }, { awaited: false }],
    undefined,
  ],
  [
    'the member it was made for, after a text that is not a code, which leaves it',
    async (links, code) => [await handedBackBy(links, dana, 'hello there'), await handedBackBy(links, dana, code)],
    [{ awaited: false }, { linked: ada }],
    { ...dana, person: ada, linkedAt: at },
  ],
];

describe('a code sent back', () => {
  it.each(sentBy)('by %s', async (_case, sending, answered, linked) => {
    const links = accountLinksInMemory();
    const code = await aCodeShownTo(links, dana);

    expect(await sending(links, code)).toEqual(answered);
    expect([await links.linkOf(dana), await links.linkOf(omar)]).toEqual([linked, undefined]);
  });

  it('by a member no code is awaited from, which links no one and ends nothing', async () => {
    const links = accountLinksInMemory();
    const code = await aCodeShownTo(links, dana);
    await linkStarted(links, publicUrl, omar);

    expect(await handedBackBy(links, omar, 'ZZZZZZ')).toEqual({ awaited: false });
    expect([await links.startOf(omar), await handedBackBy(links, dana, code)]).toEqual([
      expect.objectContaining(omar),
      { linked: ada },
    ]);
  });
});
