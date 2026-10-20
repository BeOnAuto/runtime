import { createHash } from 'node:crypto';

import type { FetchLike } from '@modelcontextprotocol/client';
import { Effect, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  consentClientWith,
  everyHost,
  registeredAt,
  returnAddress,
  servedForConsent,
  startAskedAt,
  studioBase,
  type ClientRegistration,
  type FakeMcpServer,
} from '../testing/index.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';
import type { ConsentClient, StartAsked } from './consent-client.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await servedForConsent(changes);
  closing.push(fake.close);
  return fake;
}

function started(client: ConsentClient, asked: StartAsked) {
  return Effect.runPromise(client.start(asked));
}

function refused(client: ConsentClient, asked: StartAsked) {
  return Effect.runPromise(Effect.flip(client.start(asked)));
}

function challengeOf(verifier: Redacted.Redacted): string {
  return createHash('sha256').update(Redacted.value(verifier)).digest('base64url');
}

function failingAt(path: string): FetchLike {
  return (...[address, init]: readonly [unknown, unknown?]) =>
    String(address).includes(path)
      ? Promise.resolve(new Response('failing', { status: 500 }))
      : globalThis.fetch(String(address), Object.assign({}, init));
}

function readsNothing(): Promise<Response> {
  return Promise.reject(new Error('The start reads nothing'));
}

const accounts = 'https://accounts.example.com';

const rule = 'A connection may not reach the host localhost on this runtime, which allows 127.0.0.1';

function onLoopbackAlone(url: string): string | undefined {
  return new URL(url).hostname === 'localhost' ? rule : undefined;
}

function refusingEveryHost(): string {
  return rule;
}

const explicitWay: StartAsked = {
  server: { type: 'openapi' },
  way: {
    issuer: accounts,
    scope: 'reports.read',
    authorization_endpoint: `${accounts}/o/authorize`,
    token_endpoint: `${accounts}/o/token`,
    revocation_endpoint: `${accounts}/o/revoke`,
    parameters: { access_type: 'offline', prompt: 'consent' },
  },
  returnAddress,
  reaches: everyHost,
  state: 'state-2',
  studioBase,
};

describe('the start of a consent at an MCP server', () => {
  it('answers the authorization request the server discovers, with the client, the challenge, the state, the return address, the scope, the resource and the parameters of the way', async () => {
    const fake = await served();
    const client = consentClientWith({ registeredClients: [registeredAt(fake.origin)] });
    const way = {
      scope: 'files.read offline_access',
      parameters: { access_type: 'offline', prompt: 'select_account' },
    };

    const start = await started(client, startAskedAt(fake, way));
    const url = new URL(start.url);

    expect(`${url.origin}${url.pathname}`).toBe(`${fake.origin}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'auto-runtime',
      code_challenge: challengeOf(start.verifier),
      code_challenge_method: 'S256',
      redirect_uri: returnAddress,
      state: 'state-1',
      scope: 'files.read offline_access',
      prompt: 'select_account',
      resource: `${fake.origin}/mcp`,
      access_type: 'offline',
    });
    expect(url.searchParams.getAll('prompt')).toEqual(['select_account']);
    expect(start.client).toEqual({ client_id: 'auto-runtime', client_source: 'registered' });
    expect(Redacted.isRedacted(start.verifier)).toBe(true);
  });

  it('builds the metadata from the endpoints of the way where the server publishes none, and sends no resource', async () => {
    const fake = await served({ publishesMetadata: false });
    const client = consentClientWith({ registeredClients: [registeredAt(fake.origin)] });
    const endpoints = {
      authorization_endpoint: `${fake.origin}/authorize`,
      token_endpoint: `${fake.origin}/token`,
      revocation_endpoint: `${fake.origin}/revoke`,
    };

    const { searchParams } = new URL((await started(client, startAskedAt(fake, endpoints))).url);

    expect([searchParams.has('resource'), searchParams.get('client_id')]).toEqual([false, 'auto-runtime']);
  });
});

describe('the start of a consent at an MCP server whose way gives its endpoints', () => {
  it('reads no metadata at the issuer, so metadata that names another issuer is not read', async () => {
    const echoing = await served({ issuer: 'https://elsewhere.example.com' });
    const client = consentClientWith({ registeredClients: [registeredAt(echoing.origin)] });
    const endpoints = {
      authorization_endpoint: `${echoing.origin}/authorize`,
      token_endpoint: `${echoing.origin}/token`,
      revocation_endpoint: `${echoing.origin}/revoke`,
    };

    const url = new URL((await started(client, startAskedAt(echoing, endpoints))).url);

    expect([`${url.origin}${url.pathname}`, url.searchParams.get('resource')]).toEqual([
      `${echoing.origin}/authorize`,
      `${echoing.origin}/mcp`,
    ]);
    expect(echoing.heard().map(({ path }) => path)).not.toContain('/.well-known/oauth-authorization-server');
  });
});

describe('a start refused for what its server says', () => {
  it('is refused before a client is chosen where the server names another authorization server, or its metadata another issuer', async () => {
    const another = await served({ authorizationServer: 'https://elsewhere.example.com' });
    const echoing = await served({ issuer: 'https://elsewhere.example.com' });
    const client = consentClientWith();

    expect([await refused(client, startAskedAt(another)), await refused(client, startAskedAt(echoing))]).toEqual([
      { refused: 'another_issuer', named: 'https://elsewhere.example.com', by: 'server' },
      { refused: 'another_issuer', named: 'https://elsewhere.example.com', by: 'authorization_server' },
    ]);
  });

  it('is refused before a client is chosen where the server names a resource other than its own address', async () => {
    const elsewhere = await served({ protectedResource: 'https://elsewhere.example.com/mcp' });
    const client = consentClientWith({ registeredClients: [registeredAt(elsewhere.origin)] });

    expect(await refused(client, startAskedAt(elsewhere))).toEqual({
      refused: 'another_resource',
      named: 'https://elsewhere.example.com/mcp',
    });
  });

  it('is refused where the metadata lists no S256 challenge method, and where nothing publishes metadata', async () => {
    const plain = await served({ challengeMethods: ['plain'] });
    const silent = await served({ publishesMetadata: false });
    const client = consentClientWith({ registeredClients: [registeredAt(plain.origin), registeredAt(silent.origin)] });

    expect([await refused(client, startAskedAt(plain)), await refused(client, startAskedAt(silent))]).toEqual([
      { refused: 'no_challenge' },
      { refused: 'no_metadata' },
    ]);
  });
});

describe('the start of a consent at an HTTP API whose way gives its endpoints', () => {
  it('reads nothing and answers an https address at the authorization endpoint the way names, with the client, the challenge, the state, the return address, the scope and the parameters', async () => {
    const client = consentClientWith({ fetch: readsNothing, registeredClients: [registeredAt(accounts)] });

    const { url, verifier } = await started(client, explicitWay);

    expect(url.startsWith(`${accounts}/o/authorize?`)).toBe(true);
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
      response_type: 'code',
      client_id: 'auto-runtime',
      code_challenge: challengeOf(verifier),
      code_challenge_method: 'S256',
      redirect_uri: returnAddress,
      state: 'state-2',
      scope: 'reports.read',
      access_type: 'offline',
      prompt: 'consent',
    });
  });
});

describe('the hosts a start reaches', () => {
  it('are refused in the words of the rule, among the endpoints the metadata names and at the first request alike', async () => {
    const elsewhere = await served({ endpointHost: 'localhost' });
    const fake = await served();
    const client = consentClientWith({ registeredClients: [registeredAt(elsewhere.origin)] });

    expect([
      await refused(client, { ...startAskedAt(elsewhere), reaches: onLoopbackAlone }),
      await refused(client, { ...startAskedAt(fake), reaches: refusingEveryHost }),
    ]).toEqual([
      { refused: 'host', rule },
      { refused: 'host', rule },
    ]);
  });
});

describe('a start that cannot ask the server', () => {
  it('is unanswered where the server is gone, or answers its metadata with an error', async () => {
    const gone = await servedForConsent();
    await gone.close();
    const failing = await served();

    expect([
      await refused(consentClientWith(), startAskedAt(gone)),
      await refused(consentClientWith({ fetch: failingAt('oauth-protected-resource') }), startAskedAt(failing)),
      await refused(consentClientWith({ fetch: failingAt('oauth-authorization-server') }), startAskedAt(failing)),
    ]).toEqual([{ refused: 'unanswered' }, { refused: 'unanswered' }, { refused: 'unanswered' }]);
  });

  it('is unanswered where the server does not answer within the bound of a request', async () => {
    const silent = await serveOnLoopback(() => () => Promise.withResolvers<Response>().promise);
    closing.push(silent.close);
    const fake = await served();
    const asked: StartAsked = { ...startAskedAt(fake), server: { type: 'mcp', url: `${silent.origin}/mcp` } };

    expect(await refused(consentClientWith({ requestMs: 50 }), asked)).toEqual({ refused: 'unanswered' });
  });
});

describe('the client sources a consent client judges', () => {
  it('are those of the way the runtime has, without asking anything where it takes no client of Auto’s', () => {
    const client = consentClientWith({ fetch: readsNothing, registeredClients: [registeredAt(accounts)] });
    const { sourcesOf, sourceOf } = Effect.runSync(client.hadSources(studioBase));

    expect([
      sourcesOf({ issuer: accounts }),
      sourcesOf({ issuer: accounts, clients: ['metadata_document', 'dynamic'] }),
      sourcesOf({ issuer: 'https://elsewhere.example.com' }),
    ]).toEqual([['registered'], ['dynamic'], []]);
    expect([sourceOf({ issuer: accounts }), sourceOf({ issuer: 'https://elsewhere.example.com' })]).toEqual([
      'registered',
      undefined,
    ]);
  });
});

describe('the registered client a start chooses', () => {
  it('is the client at the issuer, with a key or with neither a secret nor a key', async () => {
    const fake = await served();
    const keyed = registeredAt(fake.origin, {
      clientId: 'keyed',
      credential: { kind: 'private_key', privateKey: Redacted.make('a key in PEM'), algorithm: 'RS256' },
    });
    const open = registeredAt(fake.origin, { clientId: 'open', credential: { kind: 'public' } });

    const withKey = await started(consentClientWith({ registeredClients: [keyed] }), startAskedAt(fake));
    const withNothing = await started(consentClientWith({ registeredClients: [open] }), startAskedAt(fake));

    expect([withKey.client, withNothing.client]).toEqual([
      { client_id: 'keyed', client_source: 'registered' },
      { client_id: 'open', client_source: 'registered' },
    ]);
  });
});
