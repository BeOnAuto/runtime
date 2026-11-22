import { IssuerMismatchError } from '@modelcontextprotocol/client';
import { Redacted } from 'effect';
import { decodeJwt } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';

import type { MintingAuth } from '../settings/server-settings.ts';
import { fakeMcpInProcess, inProcessFetch, type ClientRegistration } from '../testing/index.ts';
import type { FakeMcpServer } from '../testing/served-fakes.ts';
import { askingFetch, clientSecret, refusedAt, rsaKeys, secretAuth, sourceOf } from '../testing/token-sources.ts';
import { failureOf } from './server-failures.ts';

const audience = 'https://graph.example.com/api';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function served(changes: Partial<ClientRegistration> = {}): FakeMcpServer {
  const fake = fakeMcpInProcess({
    client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600, ...changes },
  });
  closing.push(fake.close);
  return fake;
}

describe('the audience of a token request', () => {
  it('is left out when the auth block names none, and the resource is sent', async () => {
    const fake = served();
    const asking = askingFetch();

    await sourceOf(fake, secretAuth(fake), asking.fetch).source.token();

    expect(asking.bodies()).toMatchObject([{ resource: fake.url }]);
    expect(asking.bodies()).not.toHaveProperty('0.audience');
  });

  it('is sent in place of the resource, with the scope, when the auth block names both', async () => {
    const fake = served();
    const asking = askingFetch();

    await sourceOf(fake, secretAuth(fake, { audience, scope: 'graph.read' }), asking.fetch).source.token();

    expect(asking.bodies()).toMatchObject([{ grant_type: 'client_credentials', audience, scope: 'graph.read' }]);
    expect(asking.bodies()).not.toHaveProperty('0.resource');
  });

  it('is sent with no scope where the auth block names none, or an empty one, as the credentials alone ask', async () => {
    const fake = served();
    const asking = askingFetch();

    await sourceOf(fake, secretAuth(fake, { audience }), asking.fetch).source.token();
    await sourceOf(fake, secretAuth(fake, { audience, scope: '' }), asking.fetch).source.token();

    expect(asking.bodies().map((body) => Object.keys(body).toSorted())).toEqual([
      ['audience', 'grant_type'],
      ['audience', 'grant_type'],
    ]);
  });
});

describe('the audience of every token request a source makes', () => {
  it('is sent beside the client assertion a private key signs', async () => {
    const { publicKey, privateKey } = rsaKeys();
    const fake = served({ clientSecret: undefined, publicKey });
    const asking = askingFetch();
    const credential = { kind: 'private_key', private_key: Redacted.make(privateKey), algorithm: 'RS256' } as const;

    const token = await sourceOf(fake, secretAuth(fake, { audience, credential }), asking.fetch).source.token();

    expect(token).toMatch(/^token-1-/u);
    expect(asking.bodies().map((body) => Object.keys(body).toSorted())).toEqual([
      ['audience', 'client_assertion', 'client_assertion_type', 'grant_type'],
    ]);
  });

  it('is sent again when the token is renewed and when the server refuses it', async () => {
    const fake = served({ expiresInSeconds: 120 });
    const asking = askingFetch();
    const { source, clock } = sourceOf(fake, secretAuth(fake, { audience }), asking.fetch);

    await source.token();
    clock.now += 60_000;
    await source.token();
    await source.onUnauthorized(refusedAt(fake));

    expect(asking.bodies().map((body) => [body['audience'], body['resource']])).toEqual([
      [audience, undefined],
      [audience, undefined],
      [audience, undefined],
    ]);
  });
});

describe('the resource a token request with an audience leaves out', () => {
  it('is still checked against the server, so metadata that names another resource asks for no token', async () => {
    const fake = served({ protectedResource: 'https://elsewhere.example.com/mcp' });
    const { source } = sourceOf(fake, secretAuth(fake, { audience }));

    await expect(source.token()).rejects.toBeInstanceOf(Error);
    expect(fake.tokenRequests()).toBe(0);
  });

  it('is none for a server that publishes no protected-resource metadata, whose issuer is asked', async () => {
    const fake = served();
    const asking = askingFetch();
    const reach = { discovery: 'from_the_issuer', serverUrl: `${fake.origin}/api` } as const;

    await sourceOf(fake, secretAuth(fake, { audience }), asking.fetch, reach).source.token();

    expect(asking.bodies()).toMatchObject([{ audience }]);
    expect(asking.bodies()).not.toHaveProperty('0.resource');
  });
});

describe('discovery from the issuer', () => {
  it('asks the issuer for the token even when the metadata of the server names another authorization server', async () => {
    const named = served();
    const issuer = served();
    const server = served({ authorizationServers: [named.origin] });

    await sourceOf(server, secretAuth(issuer), inProcessFetch, { discovery: 'from_the_issuer' }).source.token();

    expect([issuer.tokenRequests(), named.tokenRequests(), server.tokenRequests()]).toEqual([1, 0, 0]);
  });

  it('sends its credentials to no issuer whose own metadata names another issuer, and asks for no token', async () => {
    const issuer = served({ issuer: 'https://elsewhere.example.com' });
    const server = served({ authorizationServers: [issuer.origin] });
    const { source } = sourceOf(server, secretAuth(issuer), inProcessFetch, { discovery: 'from_the_issuer' });

    await expect(source.token()).rejects.toBeInstanceOf(IssuerMismatchError);
    expect([issuer.tokenRequests(), server.tokenRequests()]).toEqual([0, 0]);
  });
});

const tenantPath = '/aaaabbbb-0000-cccc-1111-dddd2222eeee/v2.0';

const graphDefault = 'https://graph.example.com/.default';

function issuerOfATenant(changes: Partial<ClientRegistration> = {}): FakeMcpServer {
  return served({ issuerPath: tenantPath, openIdConnect: true, ...changes });
}

function fromTheIssuerOf(issuer: FakeMcpServer) {
  return { discovery: 'from_the_issuer', serverUrl: `${issuer.origin}/v1.0/users/robot@acme.example.com` } as const;
}

describe('a token asked by client credentials of an issuer with a path in its address', () => {
  it('is asked at the token endpoint the issuer’s own configuration names, once until it nears its end, with no secret in an address', async () => {
    const issuer = issuerOfATenant();
    const asking = askingFetch();
    const auth = secretAuth(issuer, { issuer: `${issuer.origin}${tenantPath}`, scope: graphDefault });
    const { source, clock, minted } = sourceOf(issuer, auth, asking.fetch, fromTheIssuerOf(issuer));

    const first = await source.token();
    const again = await source.token();
    clock.now += 3_540_001;
    const renewed = await source.token();

    expect(asking.urls()).toContain(`${issuer.origin}${tenantPath}/.well-known/openid-configuration`);
    expect(asking.bodies()).toMatchObject([
      { grant_type: 'client_credentials', scope: graphDefault },
      { grant_type: 'client_credentials', scope: graphDefault },
    ]);
    expect([again, issuer.tokenRequests(), minted.map(([, token]) => token)]).toEqual([first, 2, [first, renewed]]);
    expect(asking.urls().filter((url) => url.includes(clientSecret))).toEqual([]);
  });

  it('is never asked where the configuration at that address names another issuer, as RFC 8414 requires', async () => {
    const issuer = issuerOfATenant({ issuer: 'https://login.example.com/another-tenant/v2.0' });
    const auth = secretAuth(issuer, { issuer: `${issuer.origin}${tenantPath}`, scope: graphDefault });
    const { source } = sourceOf(issuer, auth, inProcessFetch, fromTheIssuerOf(issuer));

    await expect(source.token()).rejects.toBeInstanceOf(IssuerMismatchError);
    expect(issuer.tokenRequests()).toBe(0);
  });
});

const robot = 'robot@acme.example.com';

const inbox = 'inbox@acme.example.com';

function asAServiceAccount(issuer: FakeMcpServer, privateKey: string): MintingAuth {
  return secretAuth(issuer, {
    client_id: robot,
    scope: graphDefault,
    grant: 'jwt_bearer',
    subject: inbox,
    credential: { kind: 'private_key', private_key: Redacted.make(privateKey), algorithm: 'RS256' },
  });
}

function assertionsSentTo(bodies: readonly Readonly<Record<string, string>>[], startedAt: number) {
  return bodies.map((body) => {
    const { sub, iat, exp } = decodeJwt(String(body['assertion']));
    return [sub, Number(iat) - startedAt, Number(exp) - Number(iat)];
  });
}

function answering503(...[address, init]: readonly [unknown, unknown?]): Promise<Response> {
  return String(address).endsWith('/token')
    ? Promise.resolve(new Response(null, { status: 503 }))
    : inProcessFetch(String(address), Object.assign({}, init));
}

function fromTheIssuer(fake: FakeMcpServer) {
  return { discovery: 'from_the_issuer', serverUrl: `${fake.origin}/api` } as const;
}

describe('a token asked with a signed assertion of a service account', () => {
  it('is asked for the subject with a new assertion of five minutes each time it is renewed, and again when the server refuses it', async () => {
    const { publicKey, privateKey } = rsaKeys();
    const issuer = served({ clientSecret: undefined, clientId: robot, publicKey, subjects: [inbox] });
    const asking = askingFetch();
    const { source, clock, minted } = sourceOf(
      issuer,
      asAServiceAccount(issuer, privateKey),
      asking.fetch,
      fromTheIssuer(issuer),
    );
    const startedAt = clock.now / 1000;

    const first = await source.token();
    clock.now += 3_540_001;
    const renewed = await source.token();
    await source.onUnauthorized(refusedAt(issuer));

    expect(new Set([first, renewed, ...minted.map(([, token]) => token)]).size).toBe(3);
    expect(assertionsSentTo(asking.bodies(), startedAt)).toEqual([
      [inbox, 0, 300],
      [inbox, 3540, 300],
      [inbox, 3540, 300],
    ]);
    expect(asking.bodies().map((body) => Object.keys(body).toSorted())).toEqual(
      Array.from({ length: 3 }, () => ['assertion', 'grant_type']),
    );
  });
});

describe('a token a service account is not given', () => {
  it('fails as a refused key where the token endpoint refuses the assertion, and as a failure where it answers 503', async () => {
    const { publicKey, privateKey } = rsaKeys();
    const refusing = served({ clientSecret: undefined, clientId: robot, publicKey, subjects: [] });
    const failing = served({ clientSecret: undefined, clientId: robot, publicKey, subjects: [inbox] });

    const refused = sourceOf(
      refusing,
      asAServiceAccount(refusing, privateKey),
      inProcessFetch,
      fromTheIssuer(refusing),
    );
    const failed = sourceOf(failing, asAServiceAccount(failing, privateKey), answering503, fromTheIssuer(failing));

    expect(
      await Promise.all([refused.source.token().catch(failureOf), failed.source.token().catch(failureOf)]),
    ).toMatchObject([{ kind: 'key_refused' }, { kind: 'failing' }]);
  });
});
