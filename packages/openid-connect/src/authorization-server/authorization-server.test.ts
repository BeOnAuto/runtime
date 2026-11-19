import { createHash } from 'node:crypto';

import { statement } from '@on.auto/ledger';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  agentRedirect,
  allowed,
  authorizationAskedBy,
  connectedAt,
  exchanged,
  fieldsOf,
  formOf,
  locationOf,
  refreshed,
  registered,
  serversClosedAfterAll,
  signedInAs,
  type Connected,
  type Fields,
} from '../testing/agents-signing-in.ts';
import {
  browserAt,
  claimsAnsweredUntilStopped,
  issuer,
  refusedOrigin,
  signedInPerson,
} from '../testing/authorization-server-over-http.ts';

const aServer = serversClosedAfterAll();

const agent = await connectedAt(await aServer());

describe('the authorization server, beside other routes of one Node server behind a proxy that ends TLS', () => {
  it('names its public address as its issuer and leaves every path it does not answer to the server beside it', async () => {
    const browser = browserAt(agent.server.at);

    const metadata = await fieldsOf(await browser.at('/.well-known/openid-configuration'));
    const beside = await (await browser.at('/health')).text();

    expect(metadata).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
    });
    expect(beside).toBe('beside');
  });

  it('answers a request the middleware beside it refuses as that middleware answers it', async () => {
    const refused = await browserAt(agent.server.at).at('/oauth/token', {
      method: 'POST',
      headers: { origin: refusedOrigin },
    });

    expect([refused.status, refused.headers.get('x-request-id')]).toEqual([403, 'request-1']);
  });

  it('sets every cookie Secure, and keeps the sign-in session in __Host-Http-session with SameSite=Lax', () => {
    const session = agent.browser.setCookies.find((cookie) => cookie.startsWith('__Host-Http-session='));

    expect(agent.browser.setCookies.filter((cookie) => !/; secure/iu.test(cookie))).toEqual([]);
    expect(session).toMatch(/; path=\/;.*samesite=lax/iu);
  });

  it('keeps no token, code or session value in its rows, only their SHA-256', async () => {
    const { server, browser, code, tokens } = agent;
    const accessToken = String(tokens['access_token']);
    const session = String(browser.cookies.get('__Host-Http-session'));
    const values = [code, accessToken, String(tokens['refresh_token']), session];

    const rows = JSON.stringify(await server.connection.read(statement`SELECT * FROM auth_oidc_models`));

    expect(values.filter((value) => rows.includes(value))).toEqual([]);
    expect(rows).toContain(createHash('sha256').update(accessToken).digest('hex'));
  });
});

describe('an agent that signs a person in at the authorization server', () => {
  it('has the person signed in by the sign-in it is given and asked to allow it, then gets tokens for this server', async () => {
    const { server, tokens, clientId } = agent;

    const issued = await server.server.accessTokenOf(String(tokens['access_token']));

    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'org:read' });
    expect(typeof tokens['refresh_token']).toBe('string');
    expect(server.pagesShown.map((page) => Object.keys(page))).toEqual([['allow']]);
    expect(issued).toEqual({
      accountId: signedInPerson,
      clientId,
      clientName: 'An agent',
      scope: 'org:read',
      isStudios: false,
    });
    expect(await server.server.accessTokenOf(`${String(tokens['access_token'])}x`)).toBeUndefined();
  });
});

describe('an agent the person denies, or that asks for more or for something else', () => {
  it('is sent back with access_denied when the person denies it', async () => {
    const browser = browserAt(agent.server.at);
    const consent = locationOf(await signedInAs(browser, { clientId: await registered(browser) }));

    const denied = await browser.at(`${consent}/abort`, { method: 'POST', headers: { origin: issuer } });
    const back = new URL(locationOf(await browser.at(locationOf(denied))));

    expect([back.searchParams.get('error'), back.searchParams.get('iss')]).toEqual(['access_denied', issuer]);
  });

  it('is shown by the host its access goes to where it declares no name, and asked again for what it adds', async () => {
    const server = await aServer();
    const browser = browserAt(server.at);
    const clientId = await registered(browser, {});
    await allowed(browser, locationOf(await signedInAs(browser, { clientId })));

    const consent = await browser.at(authorizationAskedBy({ clientId, scope: 'org:read org:write' }));
    const tokens = await exchanged(browser, await allowed(browser, locationOf(consent)), { clientId });

    const shownAs = { allow: { client: '127.0.0.1:7777', publishedAt: undefined, deliveredTo: agentRedirect } };
    expect(server.pagesShown).toMatchObject([shownAs, shownAs]);
    expect(tokens['scope']).toBe('org:read org:write');
  });

  it('is refused a resource other than this server, and a request without PKCE', async () => {
    const browser = browserAt(agent.server.at);
    const withoutPkce = new URLSearchParams({
      client_id: agent.clientId,
      redirect_uri: agentRedirect,
      response_type: 'code',
    });

    const elsewhere = await browser.at(authorizationAskedBy({ clientId: agent.clientId, resource: refusedOrigin }));
    const unproven = await browser.at(`/oauth/authorize?${withoutPkce.toString()}`);

    expect([locationOf(elsewhere), locationOf(unproven)].map((at) => new URL(at).searchParams.get('error'))).toEqual([
      'invalid_target',
      'invalid_request',
    ]);
  });
});

describe('an agent that names no resource', () => {
  it('is given a token for this server where it asks for its scopes and names no resource', async () => {
    const browser = browserAt(agent.server.at);
    const asked = { clientId: await registered(browser), resource: '' };

    const code = await allowed(browser, locationOf(await signedInAs(browser, asked)));
    const tokens = await exchanged(browser, code, asked);

    expect(await agent.server.server.accessTokenOf(String(tokens['access_token']))).toMatchObject({
      scope: 'org:read',
    });
  });
});

describe('the tokens of a grant', () => {
  it('rotate the refresh token at each use, and a refresh token used again ends the whole grant', async () => {
    const { server, browser, clientId, tokens } = await connectedAt(await aServer());

    const first = await fieldsOf(await refreshed(browser, clientId, tokens['refresh_token']));
    const reused = await refreshed(browser, clientId, tokens['refresh_token']);

    expect(first['refresh_token']).not.toBe(tokens['refresh_token']);
    expect([reused.status, (await fieldsOf(reused))['error']]).toEqual([400, 'invalid_grant']);
    expect(await server.server.accessTokenOf(String(first['access_token']))).toBeUndefined();
    expect((await refreshed(browser, clientId, first['refresh_token'])).status).toBe(400);
  });

  it('end with their grant when the refresh token is revoked, or when the grant is gone', async () => {
    const revoking = await connectedAt(await aServer());
    const losing = await connectedAt(await aServer());

    const revoked = await revoking.browser.at(
      '/oauth/revoke',
      formOf({ token: String(revoking.tokens['refresh_token']), client_id: revoking.clientId }),
    );
    await losing.server.connection.write(statement`DELETE FROM auth_oidc_models WHERE model = 'Grant'`);

    expect(revoked.status).toBe(200);
    expect(await revoking.server.server.accessTokenOf(String(revoking.tokens['access_token']))).toBeUndefined();
    expect(await losing.server.server.accessTokenOf(String(losing.tokens['access_token']))).toBeUndefined();
  });
});

const aDayMs = 24 * 60 * 60_000;

interface Clocked {
  readonly start: number;
  readonly connected: Connected;
}

function aClockStopped(): number {
  const start = Date.now();
  vi.useFakeTimers({ toFake: ['Date'], now: start });
  return start;
}

async function connectedFrom(start: number): Promise<Clocked> {
  return { start, connected: await connectedAt(await aServer()) };
}

async function refreshedOn({ start, connected }: Clocked, refreshToken: unknown, days: number): Promise<Fields> {
  vi.setSystemTime(start + days * aDayMs);
  return fieldsOf(await refreshed(connected.browser, connected.clientId, refreshToken));
}

async function askedAgainOn({ start, connected }: Clocked, days: number): Promise<string> {
  vi.setSystemTime(start + days * aDayMs);
  const asked = await connected.browser.at(authorizationAskedBy({ clientId: connected.clientId }));
  return new URL(locationOf(asked), issuer).origin;
}

describe('the lifetimes of a sign-in and of its tokens', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keep a refresh token thirty days from its latest use, within a grant of ninety days', async () => {
    const start = aClockStopped();
    const lapsing = await connectedFrom(start);
    const holding = await connectedFrom(start);

    const used = await refreshedOn(lapsing, lapsing.connected.tokens['refresh_token'], 29);
    const unused = await refreshedOn(lapsing, used['refresh_token'], 60);
    const second = await refreshedOn(holding, holding.connected.tokens['refresh_token'], 29);
    const third = await refreshedOn(holding, second['refresh_token'], 58);
    const fourth = await refreshedOn(holding, third['refresh_token'], 87);
    const pastTheGrant = await refreshedOn(holding, fourth['refresh_token'], 91);

    expect([typeof used['refresh_token'], unused['error']]).toEqual(['string', 'invalid_grant']);
    expect([typeof fourth['refresh_token'], pastTheGrant['error']]).toEqual(['string', 'invalid_grant']);
  });

  it('keep the sign-in seven days unused and thirty days at most', async () => {
    const start = aClockStopped();
    const unused = await connectedFrom(start);
    const used = await connectedFrom(start);
    const theAgent = new URL(agentRedirect).origin;

    const unusedFor = [await askedAgainOn(unused, 6), await askedAgainOn(unused, 12), await askedAgainOn(unused, 20)];
    const usedUntil = [await askedAgainOn(used, 6), await askedAgainOn(used, 12), await askedAgainOn(used, 18)];
    const usedLast = [await askedAgainOn(used, 24), await askedAgainOn(used, 30.5)];

    expect(unusedFor).toEqual([theAgent, theAgent, issuer]);
    expect([...usedUntil, ...usedLast]).toEqual([theAgent, theAgent, theAgent, theAgent, issuer]);
  });
});

describe('the tokens of a grant, refused', () => {
  it('are refused once the server no longer answers for the account, whose session then signs nobody in, and to a page of another origin', async () => {
    const answering = claimsAnsweredUntilStopped();
    const { browser, clientId, tokens } = await connectedAt(await aServer({ claimsOf: answering.claimsOf }));
    const whileAnswered = new URL(locationOf(await browser.at(authorizationAskedBy({ clientId }))), issuer).origin;
    answering.stopped();

    const askedAgain = await browser.at(locationOf(await browser.at(authorizationAskedBy({ clientId }))));
    const refresh = await fieldsOf(await refreshed(browser, clientId, tokens['refresh_token']));
    const fromAPage = await browser.at('/oauth/token', {
      ...formOf({ grant_type: 'refresh_token', refresh_token: 'r', client_id: clientId }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://agent.example.test' },
    });

    expect([whileAnswered, new URL(locationOf(askedAgain)).origin]).toEqual([
      new URL(agentRedirect).origin,
      'https://login.example.test',
    ]);
    expect(refresh['error']).toBe('invalid_grant');
    expect([fromAPage.status, (await fieldsOf(fromAPage))['error']]).toEqual([400, 'invalid_request']);
  });

  it('are refused where the token is bound to a key', async () => {
    const { server, tokens } = await connectedAt(await aServer());
    const accessToken = String(tokens['access_token']);
    const unbound = await server.server.accessTokenOf(accessToken);

    await server.connection.write(
      statement`UPDATE auth_oidc_models SET payload = json_set(payload, '$.jkt', 'a-key-thumbprint') WHERE model = 'AccessToken'`,
    );

    expect([unbound === undefined, await server.server.accessTokenOf(accessToken)]).toEqual([false, undefined]);
  });

  it('answer who the person is at UserInfo for a token issued for no resource', async () => {
    const browser = browserAt(agent.server.at);
    const asked = { clientId: await registered(browser), scope: 'openid profile email', resource: '' };
    const code = await allowed(browser, locationOf(await signedInAs(browser, asked)));
    const tokens = await exchanged(browser, code, asked);
    const bearer = `Bearer ${String(tokens['access_token'])}`;

    const userInfo = await fieldsOf(await browser.at('/me', { headers: { authorization: bearer } }));

    expect(userInfo).toEqual({ sub: signedInPerson, name: 'Ada Lovelace', email: 'ada@example.test' });
    expect(await agent.server.server.accessTokenOf(String(tokens['access_token']))).toBeUndefined();
  });
});
