import { describe, expect, it } from 'vitest';

import {
  authorizationAskedBy,
  codeIn,
  exchanged,
  formOf,
  hiddenFieldsIn,
  locationOf,
  serversClosedAfterAll,
  signedInAs,
  studioClient,
  studioRedirect,
} from '../testing/agents-signing-in.ts';
import { browserAt, studioOrigin } from '../testing/authorization-server-over-http.ts';

const aServer = serversClosedAfterAll();

const studio = { clientId: studioClient, redirectUri: studioRedirect, scope: 'openid offline_access org:read' };

describe('Studio on the cloud, a client derived from its origin', () => {
  it('is never asked to be allowed, gets a refresh token, and signs in again with the session alone', async () => {
    const server = await aServer();
    const browser = browserAt(server.at);

    const tokens = await exchanged(browser, codeIn(await signedInAs(browser, studio)), studio);
    const more = await browser.at(authorizationAskedBy({ ...studio, scope: `${studio.scope} org:write` }));
    const same = await browser.at(authorizationAskedBy(studio));

    expect(server.pagesShown).toEqual([]);
    expect(typeof tokens['refresh_token']).toBe('string');
    expect(await server.server.accessTokenOf(String(tokens['access_token']))).toMatchObject({ isStudios: true });
    expect([locationOf(more), locationOf(same)].map((at) => new URL(at).origin)).toEqual([studioOrigin, studioOrigin]);
  });

  it('signs the person out at the end-session endpoint, on the page the server gives, and is sent back to its own origin', async () => {
    const server = await aServer();
    const browser = browserAt(server.at);
    await signedInAs(browser, studio);
    const asked = new URLSearchParams({ client_id: studioClient, post_logout_redirect_uri: `${studioOrigin}/` });

    const page = await browser.at(`/session/end?${asked.toString()}`);
    const confirmed = await browser.at('/session/end/confirm', formOf(hiddenFieldsIn(await page.text())));
    const sessionAfter = browser.cookies.get('__Host-Http-session');

    expect(server.pagesShown.map((shown) => Object.keys(shown))).toEqual([['signingOut']]);
    expect([locationOf(confirmed), sessionAfter]).toEqual([`${studioOrigin}/`, undefined]);
  });

  it("sends a person who signs out with no client to return to to the server's own page", async () => {
    const browser = browserAt((await aServer()).at);

    const page = await browser.at('/session/end');
    const ended = await browser.at('/session/end/confirm', formOf(hiddenFieldsIn(await page.text())));
    const toItsOwnPage = await browser.at(locationOf(ended));

    expect(page.headers.get('content-security-policy')).toMatch(/script-src 'sha256-/u);
    expect([toItsOwnPage.status, locationOf(toItsOwnPage)]).toEqual([303, '/']);
  });
});
