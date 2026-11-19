import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  allowed,
  authorizationAskedBy,
  backFromTheSignIn,
  exchanged,
  locationOf,
  pastTheEndOfARequestMs,
  registered,
  serversClosedAfterAll,
  signedInAs,
  signInBegun,
  signInEndingIn,
} from '../testing/agents-signing-in.ts';
import { browserAt, issuer, rowsFailingToRead, signingIn } from '../testing/authorization-server-over-http.ts';

const aServer = serversClosedAfterAll();

const anInteraction: unknown = expect.stringMatching(/^\/interaction\/[^/?]+$/u);

const choosingAnAccount: unknown = expect.stringMatching(/^\/interaction\/[^/]+\?prompt=select_account$/u);

describe('a sign-in that does not admit the person', () => {
  it('shows its refusal, with the account choice asked of the provider on trying again for another account', async () => {
    const server = await aServer(signInEndingIn({ refused: 'not_that_account' }));
    const browser = browserAt(server.at);

    const refused = await backFromTheSignIn(
      browser,
      await signInBegun(browser, { clientId: await registered(browser) }),
    );

    expect(refused.status).toBe(403);
    expect(server.pagesShown).toEqual([{ refused: 'not_that_account', tryAgainAt: choosingAnAccount }]);
  });

  it('shows the refusal of a person it does not take, and the failure of a sign-in, each with trying again', async () => {
    const removed = await aServer(signInEndingIn({ refused: 'no_access' }));
    const failed = await aServer({ signIn: { ...signingIn, started: () => Promise.resolve({ notStarted: true }) } });
    const browser = browserAt(removed.at);
    const another = browserAt(failed.at);

    await backFromTheSignIn(browser, await signInBegun(browser, { clientId: await registered(browser) }));
    await signInBegun(another, { clientId: await registered(another) });

    expect([...removed.pagesShown, ...failed.pagesShown]).toEqual([
      { refused: 'no_access', tryAgainAt: anInteraction },
      { refused: 'not_signed_in', tryAgainAt: anInteraction },
    ]);
  });
});

describe('a sign-in the person leaves, or asks to choose an account at', () => {
  it('sends the client access_denied when the person gives up', async () => {
    const browser = browserAt((await aServer(signInEndingIn({ gaveUp: true }))).at);

    const gaveUp = await backFromTheSignIn(
      browser,
      await signInBegun(browser, { clientId: await registered(browser) }),
    );
    const back = new URL(locationOf(await browser.at(locationOf(gaveUp))));

    expect(back.searchParams.get('error')).toBe('access_denied');
  });

  it('asks the provider for the account choice when the client asks select_account', async () => {
    const asked: boolean[] = [];
    const server = await aServer({
      signIn: {
        ...signingIn,
        started: (choosing) => {
          asked.push(choosing.selectAccount);
          return signingIn.started(choosing);
        },
      },
    });
    const browser = browserAt(server.at);

    const consent = await signedInAs(browser, { clientId: await registered(browser), prompt: 'select_account' });

    expect([asked, locationOf(consent).startsWith('/interaction/')]).toEqual([[true], true]);
  });
});

describe('a request of the sign-in that is no longer open', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the page that says so once the request has ended, by its client, and with no client for one it never held', async () => {
    const server = await aServer();
    const browser = browserAt(server.at);
    const asked = locationOf(await browser.at(authorizationAskedBy({ clientId: await registered(browser) })));
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + pastTheEndOfARequestMs });

    const ended = await browser.at(asked);
    const resumed = await browser.at(`/oauth/authorize/${asked.slice(asked.lastIndexOf('/') + 1)}`);
    const decided = await browser.at('/interaction/never-issued/confirm', {
      method: 'POST',
      headers: { origin: issuer },
    });

    expect([ended.status, resumed.status, decided.status]).toEqual([403, 403, 403]);
    expect(server.pagesShown).toEqual([
      { notOpen: { client: 'An agent' } },
      { notOpen: { client: 'An agent' } },
      { notOpen: { client: undefined } },
    ]);
  });

  it('shows the page that says so to a person who returns from the sign-in after the request ended', async () => {
    const server = await aServer();
    const browser = browserAt(server.at);
    const begun = await signInBegun(browser, { clientId: await registered(browser) });
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + pastTheEndOfARequestMs });

    const returned = await backFromTheSignIn(browser, begun);

    expect([returned.status, server.pagesShown]).toEqual([403, [{ notOpen: { client: 'An agent' } }]]);
  });

  it('answers a request it refuses before it can trust the client with the error, and a stray return with a failure', async () => {
    const server = await aServer();
    const browser = browserAt(server.at);

    const untrusted = await browser.at(authorizationAskedBy({ clientId: 'never-registered' }));
    const stray = await browser.at('/auth/oidc/callback?code=upstream-code&state=s');

    expect([untrusted.status, stray.status]).toEqual([400, 403]);
    expect(server.pagesShown).toEqual([{ refused: 'not_signed_in', tryAgainAt: undefined }]);
  });
});

describe('two requests of one browser', () => {
  it('keep each its own sign-in, so a page or a return of one is not taken for the other', async () => {
    const server = await aServer();
    const browser = browserAt(server.at);
    const clientId = await registered(browser);
    const first = locationOf(await browser.at(authorizationAskedBy({ clientId })));
    await signInBegun(browser, { clientId });
    const other = locationOf(await browser.at(authorizationAskedBy({ clientId })));

    const firstShown = await browser.at(first);
    const otherReturned = await browser.at(`${other}/federated?state=upstream-state`);

    expect([firstShown.status, otherReturned.status]).toEqual([403, 403]);
    expect(server.pagesShown).toEqual([
      { notOpen: { client: 'An agent' } },
      { refused: 'not_signed_in', tryAgainAt: anInteraction },
    ]);
  });

  it('answers a step it does not know as no route, and a request it cannot read as a failure', async () => {
    const failing = await aServer({ rowsOver: rowsFailingToRead('Interaction') });
    const browser = browserAt(failing.at);
    const asked = locationOf(await browser.at(authorizationAskedBy({ clientId: await registered(browser) })));

    const unknownStep = await browser.at(`${asked}/confirm`);
    const unread = await browser.at(asked);

    expect([unknownStep.status, unread.status]).toEqual([404, 500]);
  });
});

const documentAddress = 'https://agent.example.com/oauth/client.json';

const documentedRedirect = 'https://agent.example.com/callback';

const theDocument = {
  client_id: documentAddress,
  client_name: 'An agent',
  redirect_uris: [documentedRedirect],
  token_endpoint_auth_method: 'none',
};

const network = globalThis.fetch;

function documentOrNetwork(...[address, init]: readonly [unknown, unknown?]): Promise<Response> {
  return String(address) === documentAddress
    ? Promise.resolve(Response.json(theDocument))
    : network(String(address), Object.assign({}, init));
}

function documentPublished(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(documentOrNetwork);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
}

describe('an agent named by its Client ID Metadata Document', () => {
  it('is asked about by where its document is published and where its access goes, and gets tokens for this server', async () => {
    documentPublished();
    const server = await aServer();
    const browser = browserAt(server.at);
    const asked = { clientId: documentAddress, redirectUri: documentedRedirect };

    const code = await allowed(browser, locationOf(await signedInAs(browser, asked)));
    const tokens = await exchanged(browser, code, asked);

    const shownAs = { client: 'An agent', publishedAt: 'agent.example.com', deliveredTo: documentedRedirect };
    expect(server.pagesShown).toMatchObject([{ allow: shownAs }]);
    expect(await server.server.accessTokenOf(String(tokens['access_token']))).toMatchObject({
      clientId: documentAddress,
      clientName: 'An agent',
    });
  });
});
