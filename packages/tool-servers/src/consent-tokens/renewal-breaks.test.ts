import { HostRefused, HostUnresolved } from '@on.auto/outbound';
import { Effect, Option, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted, postedTo } from '../authorization-testing/authorization-requests.ts';
import type { ConsentClient, ConsentServed, ConsentServer } from '../consent/consent-client.ts';
import {
  brokenWords,
  clockAt,
  connectedByConsent,
  consentClientAt,
  gatedRequests,
  hostOf,
  registeredAt,
  rowOf,
  servedOf,
  servedTokensOf,
  type ClientRegistration,
  type ConsentConnected,
  type ManualClock,
  type MemoryTokens,
} from '../testing/index.ts';
import { servedForConsent, type FakeMcpServer } from '../testing/served-fakes.ts';
import { until } from '../testing/until.ts';
import { keptValueOf, type KeptTokens } from './kept-tokens.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const renewalTime = 3_540_000;

interface Connected {
  readonly fake: FakeMcpServer;
  readonly connected: ConsentConnected;
  readonly clock: ManualClock;
  readonly row: MemoryTokens;
  readonly served: ConsentServed;
  readonly first: KeptTokens;
}

async function connectedAt(changes: Partial<ClientRegistration> = {}): Promise<Connected> {
  const fake = await servedForConsent(changes);
  closing.push(fake.close);
  const connected = await connectedByConsent(fake);
  const clock = clockAt(0);
  const row = rowOf(connected, clock.now);
  const served = servedOf(connected, row);
  return { fake, connected, clock, row, served, first: connected.kept };
}

function sourceOf({ fake, clock, served }: Connected, consent: ConsentClient = consentClientAt(fake)) {
  return servedTokensOf(served, clock.now, consent).source;
}

function renewed({ clock }: Connected, source: ReturnType<typeof sourceOf>): Promise<unknown> {
  clock.setTo(renewalTime);
  return source.token().catch((error: unknown) => error);
}

function revokedGrantOf(fake: FakeMcpServer, { refresh_token: refreshToken }: KeptTokens) {
  return postedTo(fake, '/revoke', { token: Option.getOrThrow(Option.fromNullishOr(refreshToken)) });
}

interface Failing {
  still: boolean;
}

function tokensFailingWhile(failing: Readonly<Failing>) {
  const answer = { error: 'temporarily_unavailable', error_description: 'The token service is down for a moment' };
  return (...[address, init]: readonly [unknown, unknown?]): Promise<Response> =>
    failing.still && String(address).endsWith('/token')
      ? Promise.resolve(Response.json(answer, { status: 503 }))
      : globalThis.fetch(String(address), Object.assign({}, init));
}

const unauthorized = (fake: FakeMcpServer) => ({
  response: new Response(null, { status: 401 }),
  serverUrl: new URL(fake.url),
  fetchFn: globalThis.fetch,
});

describe('a refresh the server refuses as invalid_grant', () => {
  it('breaks the connection where its row still holds the tokens it refused', async () => {
    const connected = await connectedAt();
    await revokedGrantOf(connected.fake, connected.first);

    const failed = await renewed(connected, sourceOf(connected));

    expect(failed).toEqual(new Error(brokenWords('consent_ended')));
    expect(connected.row.ends()).toEqual(['consent_ended']);
    expect(connected.row.version()).toBe(1);
  });

  it('takes the tokens another process kept meanwhile, and breaks nothing', async () => {
    const connected = await connectedAt();
    const other = await connectedByConsent(connected.fake);
    const gate = gatedRequests();
    const source = sourceOf(connected, consentClientAt(connected.fake, { fetch: gate.fetch }));

    const renewing = renewed(connected, source);
    await until(() => gate.holding() === 1);
    await revokedGrantOf(connected.fake, connected.first);
    Effect.runSync(connected.row.replace(1, other.tokens));
    gate.release();

    expect(await renewing).toBe(other.kept.access_token);
    expect(connected.row.ends()).toEqual([]);
  });
});

describe('the tokens of a server that gives no refresh token', () => {
  it('are served past their end, and break the connection at the first refusal', async () => {
    const connected = await connectedAt({ issuesRefreshTokens: false });
    const source = sourceOf(connected);

    connected.clock.setTo(2 * renewalTime);
    const pastTheirEnd = await source.token();
    const refused = await source.onUnauthorized(unauthorized(connected.fake)).catch((error: unknown) => error);

    expect(pastTheirEnd).toBe(connected.first.access_token);
    expect(refused).toEqual(new Error(brokenWords('consent_ended')));
    expect(connected.fake.tokenRequests()).toBe(1);
  });
});

describe('a renewal whose client is no longer registered', () => {
  it('breaks the connection in the words of a client gone, and sends nothing', async () => {
    const connected = await connectedAt();
    const renamed = consentClientAt(connected.fake, {
      registeredClients: [registeredAt(connected.fake.origin, { clientId: 'renamed' })],
    });

    const failed = await renewed(connected, sourceOf(connected, renamed));

    expect(failed).toEqual(new Error(brokenWords('client_gone')));
    expect(connected.row.ends()).toEqual(['client_gone']);
    expect(connected.fake.tokenRequests()).toBe(1);
  });
});

describe('a renewal that fails otherwise', () => {
  it('fails the call in the words of the failure and leaves the connection connected', async () => {
    const connected = await connectedAt();

    const failed = await renewed(
      connected,
      sourceOf(connected, consentClientAt(connected.fake, { fetch: tokensFailingWhile({ still: true }) })),
    );

    expect(failed).toMatchObject({ message: 'The token service is down for a moment' });
    expect(connected.row.ends()).toEqual([]);
    expect(connected.row.version()).toBe(1);
  });

  it('is refused in the words of the rule where the rules refuse a host it reaches', async () => {
    const connected = await connectedAt();
    const rule = 'The rules of whoever runs Auto do not allow the host 127.0.0.1';
    const refusing = { ...connected, served: { ...connected.served, reaches: () => rule } };

    const failed = await renewed(refusing, sourceOf(refusing));

    expect(failed).toEqual(new HostRefused({ rule }));
  });

  it('fails in words of its own where the authorization server does not answer, or answers as it did not', async () => {
    const gone = await connectedAt();
    const moved = await connectedAt();
    const elsewhere = await servedForConsent();
    closing.push(elsewhere.close);
    const server: ConsentServer = { type: 'mcp', url: elsewhere.url };
    const movedAway = { ...moved, served: { ...moved.served, server } };
    const unansweredSource = sourceOf(gone);
    await gone.fake.close();
    closing.splice(closing.indexOf(gone.fake.close), 1);

    const unanswered = await renewed(gone, unansweredSource);
    const unrenewable = await renewed(movedAway, sourceOf(movedAway));

    expect([unanswered, unrenewable]).toEqual([
      new Error(
        `The tokens of the connection files were not renewed, since ${hostOf(gone.fake)} could not be reached for the request sent without a token; the next call tries again`,
      ),
      new Error(
        'The authorization server of the connection files no longer answers as it did when the connection was made, so its tokens cannot be renewed',
      ),
    ]);
  });
});

function resourceMetadataRefused(...[address, init]: readonly [unknown, unknown?]): Promise<Response> {
  return String(address).includes('/.well-known/oauth-protected-resource')
    ? Promise.resolve(Response.json({ error: 'access_denied' }, { status: 403 }))
    : globalThis.fetch(String(address), Object.assign({}, init));
}

describe('a renewal whose server refuses a read of its metadata with a 4xx', () => {
  it('fails in words that say the server does not serve it, and name no try again', async () => {
    const connected = await connectedAt();

    const failed = await renewed(
      connected,
      sourceOf(connected, consentClientAt(connected.fake, { fetch: resourceMetadataRefused })),
    );

    expect(failed).toEqual(
      new Error(
        `The tokens of the connection files were not renewed, since ${hostOf(connected.fake)} does not serve its protected resource metadata (HTTP 403); the server may take an API key instead of a sign-in`,
      ),
    );
    expect(connected.row.version()).toBe(1);
  });
});

const allowed: string | undefined = undefined;

function unresolvedOnLocalhost(url: string): Promise<string | undefined> {
  return new URL(url).hostname === 'localhost'
    ? Promise.reject(new HostUnresolved({ host: 'localhost' }))
    : Promise.resolve(allowed);
}

describe('a renewal whose authorization server names an endpoint whose host cannot be looked up', () => {
  it('fails in the words of an authorization server that did not answer, naming no call', async () => {
    const connected = await connectedAt({ endpointHost: 'localhost' });
    const unresolving = { ...connected, served: { ...connected.served, reaches: unresolvedOnLocalhost } };

    expect(await renewed(unresolving, sourceOf(unresolving))).toEqual(
      new Error(
        'The authorization server of the connection files did not answer as an authorization server does, so its tokens were not renewed; the next call tries again',
      ),
    );
  });
});

describe('a renewal that failed under its own claim', () => {
  it('serves the access token it holds while it lasts, then fails at once in the same words, until the claim ends', async () => {
    const connected = await connectedAt({ expiresInSeconds: 60 });
    const failing: Failing = { still: true };
    const consent = consentClientAt(connected.fake, { fetch: tokensFailingWhile(failing) });
    const { source, timer } = servedTokensOf(connected.served, connected.clock.now, consent);

    connected.clock.setTo(30_000);
    const failed = await source.token().catch((error: unknown) => error);
    connected.clock.setTo(30_001);
    const whileItLasts = await source.token();
    const refused = await source.onUnauthorized(unauthorized(connected.fake)).catch((error: unknown) => error);
    connected.clock.setTo(60_000);
    const pastItsEnd = await source.token().catch((error: unknown) => error);
    failing.still = false;
    connected.clock.setTo(75_000);
    const renewedOnceTheClaimEnds = await source.token();

    expect(failed).toMatchObject({ message: 'The token service is down for a moment' });
    expect(whileItLasts).toBe(connected.first.access_token);
    expect([refused, pastItsEnd]).toEqual([failed, failed]);
    expect(timer.waits()).toEqual([]);
    expect(connected.row.claims()).toEqual([45_000, 45_000]);
    expect(renewedOnceTheClaimEnds).not.toBe(connected.first.access_token);
  });
});

describe('renewed tokens the store refuses to keep', () => {
  it('are revoked, and the call fails in the words of the store', async () => {
    const { fake, connected, clock } = await connectedAt();
    const { access_token: accessToken, refresh_token: refreshToken, token_type: tokenType } = connected.kept;
    const lean = keptValueOf({ access_token: accessToken, refresh_token: String(refreshToken), token_type: tokenType });
    const mostCharacters = Redacted.value(lean).length;
    const row = rowOf({ ...connected, tokens: lean }, clock.now, mostCharacters);
    const gate = gatedRequests();
    const { source } = servedTokensOf(
      servedOf(connected, row),
      clock.now,
      consentClientAt(fake, { fetch: gate.fetch }),
    );
    gate.release();

    const failed = await source.onUnauthorized(unauthorized(fake)).catch((error: unknown) => error);
    const [got = ''] = gate.answered();

    expect(failed).toEqual(new Error(`A secret to keep holds more than ${mostCharacters} characters`));
    expect(await admitted(fake, got)).toBe(false);
    expect(row.version()).toBe(1);
  });
});
