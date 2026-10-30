import { Effect, Option, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted } from '../authorization-testing/authorization-requests.ts';
import { secretsOf, secretsOfServer } from '../bounds/secrets.ts';
import type { McpServerSettings } from '../settings/server-settings.ts';
import {
  autoClientsOf,
  clockAt,
  consentClientWith,
  finishAskedOf,
  registeredAt,
  rowOf,
  servedOf,
  servedTokensOf,
  startAskedAt,
  tokensKeptBy,
  type ClientRegistration,
} from '../testing/index.ts';
import { servedForConsent, servedThroughAuto, type FakeMcpServer } from '../testing/served-fakes.ts';
import type { OwnClient } from './client-sources.ts';
import type {
  ConsentClient,
  ConsentServed,
  ConsentWay,
  FinishAsked,
  FinishedConsent,
  StartAsked,
} from './consent-client.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const appSecret = 'the-org-app-client-secret-91d0';

const theOrgsApp: OwnClient = { clientId: 'org-app', clientSecret: Redacted.make(appSecret) };

const ofTheOrgsApp: Partial<ClientRegistration> = { clientId: 'org-app', clientSecret: appSecret };

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await servedForConsent({ ...ofTheOrgsApp, ...changes });
  closing.push(fake.close);
  return fake;
}

function underTheOrgsApp(fake: FakeMcpServer, way: Partial<ConsentWay> = {}): StartAsked {
  return { ...startAskedAt(fake, { app: 'own', ...way }), ownClient: theOrgsApp };
}

interface TokenRequestSeen {
  readonly authorization: string | null;
  readonly clientSecret: string | null;
}

function recordingTokenRequests() {
  const seen: TokenRequestSeen[] = [];
  const fetch = async (...[address, init]: readonly [unknown, unknown?]): Promise<Response> => {
    const request = new Request(String(address), Object.assign({}, init));
    if (new URL(request.url).pathname === '/token') {
      const form = new URLSearchParams(await request.clone().text());
      seen.push({ authorization: request.headers.get('authorization'), clientSecret: form.get('client_secret') });
    }
    return globalThis.fetch(request);
  };
  return { fetch, seen: (): readonly TokenRequestSeen[] => [...seen] };
}

function finished(client: ConsentClient, asked: FinishAsked): Promise<FinishedConsent> {
  return Effect.runPromise(client.finish(asked).pipe(Effect.provide(TestClock.layer())));
}

const asTheOrgsApp = `Basic ${btoa(`org-app:${appSecret}`)}`;

async function redeemedAt(fake: FakeMcpServer, asked: StartAsked) {
  const recording = recordingTokenRequests();
  const client = consentClientWith({ fetch: recording.fetch });
  const done = await finished(client, await finishAskedOf(client, asked));
  return {
    client: done.client,
    admitted: await admitted(fake, tokensKeptBy(done).access_token),
    seen: recording.seen(),
  };
}

describe('the start of a consent under the org’s own app', () => {
  it('sends the person to the authorization endpoint with the org’s client, before a client registered here at the issuer, and never through Auto’s consent service', async () => {
    const serving = await servedThroughAuto(ofTheOrgsApp);
    closing.push(serving.close);
    const { fake, service } = serving;
    const client = consentClientWith({
      registeredClients: [registeredAt(fake.origin)],
      autoClients: autoClientsOf(service),
    });

    const start = await Effect.runPromise(client.start(underTheOrgsApp(fake)));
    const page = new URL(start.url);

    expect(start.client).toEqual({ client_id: 'org-app', client_source: 'own' });
    expect([`${page.origin}${page.pathname}`, page.searchParams.get('client_id')]).toEqual([
      `${fake.origin}/authorize`,
      'org-app',
    ]);
    expect(service.calls()).toEqual([]);
  });

  it('is refused as having no client where the org’s client is not given', async () => {
    const fake = await served();
    const { ownClient: _given, ...ungiven } = underTheOrgsApp(fake);

    expect(await Effect.runPromise(Effect.flip(consentClientWith().start(ungiven)))).toEqual({ refused: 'no_client' });
  });
});

describe('the finish of a consent under the org’s own app', () => {
  it('redeems the code with the org’s client, its secret in the Basic header where the metadata lists client_secret_basic or where the way writes out its endpoints, and in the form where the metadata lists client_secret_post alone', async () => {
    const listingBoth = await served();
    const listingThePost = await served({ takesBasicSecrets: false });
    const unpublished = await served({ publishesMetadata: false });
    const endpoints = {
      authorization_endpoint: `${unpublished.origin}/authorize`,
      token_endpoint: `${unpublished.origin}/token`,
    };
    const redeemed = await Promise.all([
      redeemedAt(listingBoth, underTheOrgsApp(listingBoth)),
      redeemedAt(listingThePost, underTheOrgsApp(listingThePost)),
      redeemedAt(unpublished, underTheOrgsApp(unpublished, endpoints)),
    ]);

    const byTheOrgsApp = { client_id: 'org-app', client_source: 'own' };
    expect(redeemed).toEqual([
      { client: byTheOrgsApp, admitted: true, seen: [{ authorization: asTheOrgsApp, clientSecret: null }] },
      { client: byTheOrgsApp, admitted: true, seen: [{ authorization: null, clientSecret: appSecret }] },
      { client: byTheOrgsApp, admitted: true, seen: [{ authorization: asTheOrgsApp, clientSecret: null }] },
    ]);
  });

  it('is refused as the client gone where the client given is not the one the consent was started with', async () => {
    const fake = await served();
    const client = consentClientWith();
    const asked = await finishAskedOf(client, underTheOrgsApp(fake));
    const another = { clientId: 'another-app', clientSecret: Redacted.make('another-app-client-secret-0c4f') };

    expect([
      await Effect.runPromise(Effect.flip(client.finish({ ...asked, ownClient: another }))),
      await Effect.runPromise(Effect.flip(client.finish({ ...asked, ownClient: undefined }))),
    ]).toEqual([{ refused: 'client_gone' }, { refused: 'client_gone' }]);
  });
});

async function servedUnderTheOrgsApp() {
  const fake = await served();
  const client = consentClientWith({ renewalSpreadMs: 0 });
  const asked = await finishAskedOf(client, underTheOrgsApp(fake));
  const done = await finished(client, asked);
  const connected = { fake, client: done.client, tokens: done.tokens, kept: tokensKeptBy(done) };
  const clock = clockAt(0);
  const row = rowOf(connected, clock.now);
  const consent: ConsentServed = { ...servedOf(connected, row, { app: 'own' }), ownClient: theOrgsApp };
  return { fake, client, asked, connected, clock, row, consent };
}

describe('the tokens of a connection under the org’s own app', () => {
  it('are renewed and revoked with the org’s client', async () => {
    const { fake, client, asked, connected, clock, row, consent } = await servedUnderTheOrgsApp();
    const { source } = servedTokensOf(consent, clock.now, client);

    clock.setTo(3_540_000);
    const renewed = await source.token();
    const tokens = Option.getOrThrow(Option.fromNullishOr(row.kept()));
    await Effect.runPromise(client.revoke({ ...asked, client: connected.client, tokens }));

    expect(renewed).not.toBe(connected.kept.access_token);
    expect(fake.tokenRequests()).toBe(2);
    expect(await admitted(fake, renewed)).toBe(false);
  });
});

describe('the secrets the answers of a connection under the org’s own app are scrubbed of', () => {
  it('hold the secret of the org’s client beside its tokens', async () => {
    const { fake, consent } = await servedUnderTheOrgsApp();
    const settings: McpServerSettings = {
      type: 'mcp',
      name: 'files',
      url: fake.url,
      headers: new Map(),
      auth: { issuer: fake.origin, client_id: 'org-app', scope: null, credential: { kind: 'consent', ...consent } },
      orgs: ['acme'],
      playbooks: null,
      allowed: null,
      record_content: false,
      request_id: null,
      secrets: [],
      connection: 'connection-1',
      provider: 'files',
    };

    expect(secretsOf(secretsOfServer(settings)).scrub(`echoed ${appSecret}`)).toBe('echoed [redacted]');
  });
});
