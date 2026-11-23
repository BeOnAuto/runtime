import type { LinkShown } from '@on.auto/openid-connect/authorization-server';
import { describe, expect, it } from 'vitest';

import {
  accountLinksInMemory,
  aLinkCodeKey,
  keyedHashOf,
  linkCodeKeysOf,
} from '../testing/account-linking/account-links-in-memory.ts';
import {
  aCodeShownTo,
  ada,
  at,
  codesOf,
  dana,
  hashed,
  keys,
  linkFor,
  named,
  names,
  omar,
  publicUrl,
} from '../testing/account-linking/linking-fixtures.ts';
import { accountLinkingOf, codeHandedBack, linkingOf, linkStarted, type LinkingServed } from './account-linking.ts';
import type { AccountLinks, LinkStart, MemberOfAnAccount } from './account-links.ts';
import { secretOf } from './link-secrets.ts';

const choices = { allowAt: '/interaction/i1/confirm', denyAt: '/interaction/i1/abort', tryAgainAt: '/interaction/i1' };

describe('a link started for a member of an account', () => {
  it('opens no start someone allowed, and takes no code awaited for a member as the value of a link', async () => {
    const links = accountLinksInMemory();
    const code = await aCodeShownTo(links, dana);
    await links.started({ ...omar, secret: secretOf('a-value-allowed-before'), person: ada });

    const linking = accountLinkingOf(links, names, keys);

    expect([await linking.opened(code), await linking.opened('a-value-allowed-before')]).toEqual([false, false]);
  });

  it('opens the server’s own address with a value of its own, which only its start keeps, as a hash', async () => {
    const links = accountLinksInMemory();

    const link = await linkStarted(links, publicUrl, dana);

    const value = link.slice(`${publicUrl}/account-links/`.length);
    expect(link).toMatch(/^https:\/\/auto\.example\.test\/account-links\/[\w-]{43}$/u);
    expect(await links.startOf(dana)).toEqual({ ...dana, secret: secretOf(value) });
    expect(await accountLinkingOf(links, names, keys).opened(value)).toBe(true);
  });

  it('stops the link started before it for the same member, and no other member’s', async () => {
    const links = accountLinksInMemory();
    const linking = accountLinkingOf(links, names, keys);
    const [older, others] = [await linkFor(links, dana), await linkFor(links, omar)];

    const newer = await linkFor(links, dana);

    expect([
      await linking.opened(older),
      await linking.opened(newer),
      await linking.opened(others),
      await linking.opened('a-value-never-given'),
    ]).toEqual([false, true, true, false]);
  });
});

const notShown: ReadonlyArray<readonly [string, MemberOfAnAccount, LinkShown]> = [
  ['the service names no such member', omar, { unnamed: { service: 'A chat', tryAgainAt: choices.tryAgainAt } }],
  ['the account is no longer connected', { account: 'T-gone', member: 'U-dana' }, { ended: true }],
];

describe('the page that asks to allow a link', () => {
  it('names the service, the member and their account as the service names them, by the ids of the start', async () => {
    const links = accountLinksInMemory();
    const value = await linkFor(links, dana);

    const shown = await accountLinkingOf(links, names, keys).allowShown(value, choices);

    expect(shown).toEqual({
      allow: {
        service: 'A chat',
        memberName: 'Dana Reyes',
        accountName: 'Northwind',
        allowAt: choices.allowAt,
        denyAt: choices.denyAt,
      },
    });
  });

  it.each(notShown)('is not shown where %s', async (_case, member, shown) => {
    const links = accountLinksInMemory();
    const value = await linkFor(links, member);

    expect(await accountLinkingOf(links, names, keys).allowShown(value, choices)).toEqual(shown);
    expect(await links.startOf(member)).toMatchObject(member);
  });

  it('says the link stopped working where its start was allowed, replaced or never made', async () => {
    const links = accountLinksInMemory();
    const linking = accountLinkingOf(links, names, keys, codesOf('BCDFGH'));
    const allowedBefore = await linkFor(links, dana);
    await linking.allowed(allowedBefore, ada);
    const replaced = await linkFor(links, omar);
    await linkFor(links, omar);

    expect([
      await linking.allowShown(allowedBefore, choices),
      await linking.allowShown(replaced, choices),
      await linking.allowShown('a-value-never-given', choices),
    ]).toEqual([{ ended: true }, { ended: true }, { ended: true }]);
  });
});

describe('a link allowed', () => {
  it('shows a code for the member to send back and keeps it hashed, with the person who allowed it, in place of the link', async () => {
    const links = accountLinksInMemory();
    const linking = accountLinkingOf(links, names, keys, codesOf('BCDFGH'));
    const value = await linkFor(links, dana);

    const shown = await linking.allowed(value, ada);

    expect(shown).toEqual({ code: { ...named, code: 'BCDFGH' } });
    expect(await links.startOf(dana)).toEqual({ ...dana, secret: hashed.of('BCDFGH'), person: ada });
    expect([await linking.opened(value), await linking.allowed(value, ada)]).toEqual([false, { ended: true }]);
  });

  it('keeps the code under the server’s key alone: never its plain SHA-256, and another value under another key', async () => {
    const links = accountLinksInMemory();
    await aCodeShownTo(links, dana, 'BCDFGH');

    const kept = (await links.startOf(dana))?.secret;

    expect([kept === secretOf('BCDFGH'), kept === keyedHashOf(2).of('BCDFGH'), kept === hashed.of('BCDFGH')]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('shows no code and keeps the link open where the account is no longer connected', async () => {
    const links = accountLinksInMemory();
    const linking = accountLinkingOf(links, names, keys);
    const gone = { account: 'T-gone', member: 'U-dana' };
    const value = await linkFor(links, gone);

    expect([await linking.allowed(value, ada), await linking.opened(value)]).toEqual([{ ended: true }, true]);
  });
});

describe('a link denied', () => {
  it('ends its start and says nothing was connected, once', async () => {
    const links = accountLinksInMemory();
    const linking = accountLinkingOf(links, names, keys);
    const value = await linkFor(links, dana);

    const denied = [await linking.denied(value), await linking.denied(value)];

    expect(denied).toEqual([{ denied: named }, { ended: true }]);
    expect(await links.startOf(dana)).toBeUndefined();
  });

  it('ends its start where the account is no longer connected, saying the link stopped', async () => {
    const links = accountLinksInMemory();
    const gone = { account: 'T-gone', member: 'U-dana' };
    const value = await linkFor(links, gone);

    expect(await accountLinkingOf(links, names, keys).denied(value)).toEqual({ ended: true });
    expect(await links.startOf(gone)).toBeUndefined();
  });
});

const meanwhile: ReadonlyArray<readonly [string, (links: AccountLinks) => Promise<unknown>, LinkShown]> = [
  ['before the code is used', () => Promise.resolve(), { code: { ...named, code: 'BCDFGH' } }],
  ['after the code is used', (links) => codeHandedBack({ links, hashed }, dana, 'BCDFGH', at), { ended: true }],
  ['after a newer start for the member', (links) => linkFor(links, dana), { ended: true }],
  [
    'after a wrong code from the member',
    (links) => codeHandedBack({ links, hashed }, dana, 'ZZZZZZ', at),
    { ended: true },
  ],
  ['after the person who allowed it is removed', (links) => links.personForgotten(ada), { ended: true }],
];

describe('the page of a code, loaded again in the browser that keeps the code sealed', () => {
  it.each(meanwhile)(
    '%s, shows the code while it still counts and that the link stopped otherwise',
    async (_case, then, shown) => {
      const links = accountLinksInMemory();
      const linking = accountLinkingOf(links, names, keys, codesOf('BCDFGH'));
      await linking.allowed(await linkFor(links, dana), ada);
      const sealed = await linking.codeSealed('BCDFGH');

      await then(links);

      expect(await linking.codeShownAgain(sealed)).toEqual(shown);
    },
  );

  it.each([
    ['the code itself', () => 'BCDFGH'],
    ['the code sealed under another key', () => linkCodeKeysOf(2).seal.sealed('BCDFGH')],
    ['nothing', () => ''],
  ])('shows no code for %s, which no browser was given, though the code still counts', async (_case, given) => {
    const links = accountLinksInMemory();
    await aCodeShownTo(links, dana, 'BCDFGH');

    expect(await accountLinkingOf(links, names, keys).codeShownAgain(given())).toEqual({ ended: true });
  });

  it.each<readonly [string, Omit<LinkStart, 'secret'>]>([
    ['a start that awaits no code', dana],
    ['a start whose account is no longer connected', { account: 'T-gone', member: 'U-dana', person: ada }],
  ])('shows no code for %s', async (_case, start) => {
    const links = accountLinksInMemory();
    await links.started({ ...start, secret: hashed.of('BCDFGH') });

    expect(await accountLinkingOf(links, names, keys).codeShownAgain(keys.seal.sealed('BCDFGH'))).toEqual({
      ended: true,
    });
  });
});

function endedMeanwhile(links: AccountLinks): AccountLinks {
  return { ...links, startEnded: () => Promise.resolve(false) };
}

describe('a start another request ended between its reading and its end', () => {
  it('shows no code, says nothing was declined and links no one', async () => {
    const links = accountLinksInMemory();
    const linking = accountLinkingOf(endedMeanwhile(links), names, keys, codesOf('BCDFGH'));
    const value = await linkFor(links, dana);
    const code = await aCodeShownTo(links, omar);

    expect([
      await linking.allowed(value, ada),
      await linking.denied(value),
      await codeHandedBack({ links: endedMeanwhile(links), hashed }, omar, code, at),
    ]).toEqual([{ ended: true }, { ended: true }, { awaited: false }]);
    expect(await links.linkOf(omar)).toBeUndefined();
  });
});

const bothAnd = (served: LinkingServed): LinkingServed => ({
  accountLinks: accountLinksInMemory(),
  namesFromTheService: names,
  ...served,
});

const servedWith: ReadonlyArray<readonly [string, LinkingServed, boolean]> = [
  ['nothing', {}, false],
  [
    'a store of links and the server’s key',
    { accountLinks: accountLinksInMemory(), linkCodeKey: aLinkCodeKey(1) },
    false,
  ],
  ['the names of a service and the server’s key', { namesFromTheService: names, linkCodeKey: aLinkCodeKey(1) }, false],
  ['a store of links and the names of a service, and no key', bothAnd({}), false],
  ['both, and a key that is not 32 bytes', bothAnd({ linkCodeKey: aLinkCodeKey(1, 31) }), false],
  ['both, and the server’s key', bothAnd({ linkCodeKey: aLinkCodeKey(1) }), true],
];

describe('the linking a server that signs people in serves', () => {
  it.each(servedWith)('given %s, is served only with all three', (_case, served, linking) => {
    expect('linking' in linkingOf(served)).toBe(linking);
  });
});
