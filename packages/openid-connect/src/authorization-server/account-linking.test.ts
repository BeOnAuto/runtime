import { describe, expect, it } from 'vitest';

import {
  allowed,
  authorizationAskedBy,
  exchanged,
  locationOf,
  registered,
  signedInAs,
} from '../testing/agents-signing-in.ts';
import { browserAt, issuer, signedInPerson } from '../testing/authorization-server-over-http.ts';
import type { Browser } from '../testing/authorization-server-over-http.ts';
import {
  aChallenge,
  aCode,
  allowPagesIn,
  backAtTheServer,
  callsNamed,
  choicesOf,
  codeCookie,
  linkCookie,
  linkingClient,
  linkingServersClosedAfterAll,
  named,
  openLink,
  ownRedirect,
  sealedOf,
  stateCarriedBy,
  toTheAllowPage,
} from '../testing/linking-accounts.ts';

const { aServer, aLinkingServer } = linkingServersClosedAfterAll();

describe('a link to link an account, opened in a browser', () => {
  it('sends the browser to the authorization server as its own client, with PKCE and a state kept in a cookie of the session, neither kept nor passed on', async () => {
    const { browser, heard } = await aLinkingServer();

    const opened = await browser.at(`/account-links/${openLink}`);

    const asked = new URL(locationOf(opened), issuer);
    const kept = browser.setCookies.find((cookie) => cookie.startsWith(`${linkCookie}=`));
    expect([
      opened.status,
      asked.pathname,
      opened.headers.get('cache-control'),
      opened.headers.get('referrer-policy'),
    ]).toEqual([303, '/oauth/authorize', 'no-store', 'no-referrer']);
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      client_id: linkingClient,
      redirect_uri: ownRedirect,
      response_type: 'code',
      scope: 'openid',
      state: stateCarriedBy(browser),
      code_challenge: aChallenge,
      code_challenge_method: 'S256',
    });
    expect(String(kept).split('; ').slice(1).toSorted()).toEqual(['httponly', 'path=/', 'samesite=lax', 'secure']);
    expect(heard.heard()).toEqual([['opened', openLink]]);
  });

  it('shows that it stopped working where its start is no longer open, and keeps nothing in the browser', async () => {
    const { server, browser } = await aLinkingServer();

    const opened = await browser.at('/account-links/a-link-used-before');

    expect([opened.status, opened.headers.get('referrer-policy'), browser.cookies.has(linkCookie)]).toEqual([
      200,
      'no-referrer',
      false,
    ]);
    expect(server.pagesShown).toEqual([{ link: { ended: true } }]);
  });
});

describe('a person who opened such a link and signed in', () => {
  it('is asked to allow it on the page of the start, every time they open the link', async () => {
    const { server, browser, heard } = await aLinkingServer();

    const first = await toTheAllowPage(browser);
    await backAtTheServer(browser, first, 'abort');
    const again = locationOf(await browser.at(locationOf(await browser.at(`/account-links/${openLink}`))));
    await browser.at(again);

    expect(allowPagesIn(server.pagesShown)).toEqual([
      {
        link: { allow: { service: named.service, memberName: 'Dana', accountName: 'Northwind', ...choicesOf(first) } },
      },
      {
        link: { allow: { service: named.service, memberName: 'Dana', accountName: 'Northwind', ...choicesOf(again) } },
      },
    ]);
    expect(callsNamed(heard.heard(), 'allowShown')).toEqual([
      ['allowShown', openLink],
      ['allowShown', openLink],
    ]);
  });

  it('is shown that the link stopped working, where the browser asking holds no start or another one', async () => {
    const { server, browser } = await aLinkingServer();
    const consent = await toTheAllowPage(browser);
    const kept = String(browser.cookies.get(linkCookie));

    browser.cookieSet(linkCookie, kept.replace(stateCarriedBy(browser), 'another-state'));
    await browser.at(consent);
    browser.cookieSet(linkCookie, '');
    await browser.at(consent);

    expect(server.pagesShown.slice(-2)).toEqual([{ link: { ended: true } }, { link: { ended: true } }]);
  });
});

describe('a person who signed in at such a link and decided', () => {
  it('who allows it, is shown the page the start answers for them, by the code the server took itself, which no one can take again', async () => {
    const { server, browser, heard } = await aLinkingServer();
    const consent = await toTheAllowPage(browser);

    const returnedTo = new URL(await backAtTheServer(browser, consent, 'confirm'));
    const code = String(returnedTo.searchParams.get('code'));
    const answered = await browser.at(returnedTo.href);

    expect(`${returnedTo.origin}${returnedTo.pathname}`).toBe(ownRedirect);
    expect([answered.status, server.pagesShown.at(-1), browser.cookies.has(linkCookie)]).toEqual([
      200,
      { link: { code: { ...named, code: 'BCDFGH' } } },
      false,
    ]);
    expect(heard.heard().at(-1)).toEqual(['allowed', openLink, signedInPerson]);
    expect(await exchanged(browser, code, { clientId: linkingClient, redirectUri: ownRedirect, resource: '' })).toEqual(
      {
        error: 'invalid_grant',
        error_description: 'grant request is invalid',
      },
    );
    expect((await server.rows.listed('Grant')).filter(({ payload }) => payload.includes(linkingClient))).toEqual([]);
  });

  it('who denies it, is shown the page the start answers for a refusal', async () => {
    const { server, browser, heard } = await aLinkingServer();
    const consent = await toTheAllowPage(browser);

    const returnedTo = new URL(await backAtTheServer(browser, consent, 'abort'));
    await browser.at(returnedTo.href);

    expect([returnedTo.searchParams.get('error'), server.pagesShown.at(-1)]).toEqual([
      'access_denied',
      { link: { denied: named } },
    ]);
    expect(heard.heard().at(-1)).toEqual(['denied', openLink]);
  });
});

async function aCodeShown(counts: boolean) {
  const { server, heard, browser } = await aLinkingServer();
  const codePage = await backAtTheServer(browser, await toTheAllowPage(browser), 'confirm');
  await browser.at(codePage);
  if (!counts) {
    heard.codeEnded();
  }
  const seen = () => [
    server.pagesShown.at(-1),
    browser.cookies.has(codeCookie),
    callsNamed(heard.heard(), 'codeShownAgain'),
  ];
  return { browser, another: browserAt(server), codePage, seen } as const;
}

type CodeShown = Awaited<ReturnType<typeof aCodeShown>>;

const inItsBrowser = ({ browser, codePage }: CodeShown) => browser.at(codePage);

const inAnotherBrowser = ({ another, codePage }: CodeShown) => another.at(codePage);

const atAnotherReturn = ({ browser, codePage }: CodeShown) => browser.at(codePage.replace(/state=[\w-]+/u, 'state=a'));

const [shownAgain, stopped] = [{ link: { code: { ...named, code: aCode } } }, { link: { ended: true } }] as const;

const askedOnce = [['codeShownAgain', sealedOf(aCode)]];

describe('the page of a code, loaded again', () => {
  it('keeps the return’s state and the code as the server sealed it in a cookie of the session, never the code', async () => {
    const { browser, codePage } = await aCodeShown(true);

    const [kept, state] = [
      browser.setCookies.find((set) => set.startsWith(codeCookie)),
      new URL(codePage).searchParams,
    ];

    expect(browser.cookies.get(codeCookie)).toBe(`${String(state.get('state'))}.${sealedOf(aCode)}`);
    expect(String(kept).split('; ').slice(1).toSorted()).toEqual(['httponly', 'path=/', 'samesite=lax', 'secure']);
  });

  it.each<readonly [string, boolean, (shown: CodeShown) => Promise<unknown>, readonly unknown[]]>([
    ['before it is used, in its browser', true, inItsBrowser, [shownAgain, true, askedOnce]],
    ['once it is used or replaced by a newer start', false, inItsBrowser, [stopped, false, askedOnce]],
    ['in another browser, which holds no cookie', true, inAnotherBrowser, [stopped, true, []]],
    ['at the return of another link', true, atAnotherReturn, [stopped, true, []]],
  ])('%s, shows what the server answers for it', async (_case, counts, loadedAgain, answered) => {
    const shown = await aCodeShown(counts);

    await loadedAgain(shown);

    expect(shown.seen()).toEqual(answered);
  });
});

describe('the return to the server of a link to an account, in a browser that holds another state', () => {
  const ended = { link: { ended: true } } as const;

  const refused = { refused: 'not_signed_in', tryAgainAt: undefined } as const;

  it.each([
    ['no state the browser holds', (_browser: Browser) => '', ended],
    ['another state', (_browser: Browser) => `${openLink}.another-state.a-verifier`, ended],
    ['another verifier', (browser: Browser) => `${openLink}.${stateCarriedBy(browser)}.another-verifier`, refused],
  ])('with %s takes no code, answers nothing of the start and forgets the state', async (_case, carried, shown) => {
    const { server, browser, heard } = await aLinkingServer();
    const returnedTo = await backAtTheServer(browser, await toTheAllowPage(browser), 'confirm');
    browser.cookieSet(linkCookie, carried(browser));

    await browser.at(returnedTo);

    expect([server.pagesShown.at(-1), browser.cookies.has(linkCookie)]).toEqual([shown, false]);
    expect(callsNamed(heard.heard(), 'allowed', 'denied')).toEqual([]);
  });
});

describe('the return to the server of a link to an account, with a code', () => {
  it('takes no state given twice', async () => {
    const { server, browser } = await aLinkingServer();
    await browser.at(`/account-links/${openLink}`);
    const state = stateCarriedBy(browser);

    await browser.at(`/account-links?state=${state}&state=${state}&code=a-code`);

    expect(server.pagesShown.at(-1)).toEqual({ link: { ended: true } });
  });

  it('refuses a code made for another client, one made up, one used before and an error it does not know', async () => {
    const { server, browser } = await aLinkingServer();
    const agents = browserAt(server);
    const agentsCode = await allowed(
      agents,
      locationOf(await signedInAs(agents, { clientId: await registered(agents) })),
    );
    const backFromAllow = new URL(await backAtTheServer(browser, await toTheAllowPage(browser), 'confirm'));
    const linkingCode = String(backFromAllow.searchParams.get('code'));
    await browser.at(backFromAllow.href);
    const returnedWith = async (query: string) => {
      await browser.at(`/account-links/${openLink}`);
      await browser.at(`/account-links?state=${stateCarriedBy(browser)}&${query}`);
      return server.pagesShown.at(-1);
    };

    const answered = [
      await returnedWith(`code=${agentsCode}`),
      await returnedWith('code=made-up'),
      await returnedWith(`code=${linkingCode}`),
      await returnedWith('code='),
      await returnedWith('error=server_error'),
    ];

    expect(answered).toEqual(Array.from({ length: 5 }, () => ({ refused: 'not_signed_in', tryAgainAt: undefined })));
  });

  it('names no client where its request is no longer open', async () => {
    const { server, browser } = await aLinkingServer();
    const consent = await toTheAllowPage(browser);
    await backAtTheServer(browser, consent, 'abort');

    await browser.at(`${consent}/confirm`, { method: 'POST', headers: { origin: issuer } });

    expect(server.pagesShown.at(-1)).toEqual({ notOpen: { client: undefined } });
  });
});

describe('the paths of a server', () => {
  it('given no linking, are none of the link and its return, and its authorization endpoint refuses the client', async () => {
    const server = await aServer();
    const browser = browserAt(server);

    const asked = await browser.at(
      authorizationAskedBy({ clientId: linkingClient, redirectUri: ownRedirect, scope: 'openid', resource: '' }),
    );

    expect([server.server.answers('/account-links'), server.server.answers(`/account-links/${openLink}`)]).toEqual([
      false,
      false,
    ]);
    expect(asked.status).toBe(400);
  });

  it('given linking, are the link with one value and the return, and nothing below them', async () => {
    const { server } = await aLinkingServer();
    const paths = ['/account-links', `/account-links/${openLink}`, '/account-links/', `/account-links/${openLink}/x`];

    expect(paths.map((path) => server.server.answers(path))).toEqual([true, true, false, false]);
  });
});
