import { IssuerMismatchError } from '@modelcontextprotocol/client';
import { Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ClientRegistration } from '../testing/index.ts';
import { serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';
import { askingFetch, clientSecret, refusedAt, rsaKeys, secretAuth, sourceOf } from '../testing/token-sources.ts';

const audience = 'https://graph.example.com/api';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({
    client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600, ...changes },
  });
  closing.push(fake.close);
  return fake;
}

describe('the audience of a token request', () => {
  it('is left out when the auth block names none, and the resource is sent', async () => {
    const fake = await served();
    const asking = askingFetch();

    await sourceOf(fake, secretAuth(fake), asking.fetch).source.token();

    expect(asking.bodies()).toMatchObject([{ resource: fake.url }]);
    expect(asking.bodies()).not.toHaveProperty('0.audience');
  });

  it('is sent in place of the resource, with the scope, when the auth block names both', async () => {
    const fake = await served();
    const asking = askingFetch();

    await sourceOf(fake, secretAuth(fake, { audience, scope: 'graph.read' }), asking.fetch).source.token();

    expect(asking.bodies()).toMatchObject([{ grant_type: 'client_credentials', audience, scope: 'graph.read' }]);
    expect(asking.bodies()).not.toHaveProperty('0.resource');
  });

  it('is sent with no scope where the auth block names none, or an empty one, as the credentials alone ask', async () => {
    const fake = await served();
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
    const fake = await served({ clientSecret: undefined, publicKey });
    const asking = askingFetch();
    const credential = { kind: 'private_key', private_key: Redacted.make(privateKey), algorithm: 'RS256' } as const;

    const token = await sourceOf(fake, secretAuth(fake, { audience, credential }), asking.fetch).source.token();

    expect(token).toMatch(/^token-1-/u);
    expect(asking.bodies().map((body) => Object.keys(body).toSorted())).toEqual([
      ['audience', 'client_assertion', 'client_assertion_type', 'grant_type'],
    ]);
  });

  it('is sent again when the token is renewed and when the server refuses it', async () => {
    const fake = await served({ expiresInSeconds: 120 });
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
    const fake = await served({ protectedResource: 'https://elsewhere.example.com/mcp' });
    const { source } = sourceOf(fake, secretAuth(fake, { audience }));

    await expect(source.token()).rejects.toBeInstanceOf(Error);
    expect(fake.tokenRequests()).toBe(0);
  });

  it('is none for a server that publishes no protected-resource metadata, whose issuer is asked', async () => {
    const fake = await served();
    const asking = askingFetch();
    const reach = { discovery: 'from_the_issuer', serverUrl: `${fake.origin}/api` } as const;

    await sourceOf(fake, secretAuth(fake, { audience }), asking.fetch, reach).source.token();

    expect(asking.bodies()).toMatchObject([{ audience }]);
    expect(asking.bodies()).not.toHaveProperty('0.resource');
  });
});

describe('discovery from the issuer', () => {
  it('asks the issuer for the token even when the metadata of the server names another authorization server', async () => {
    const named = await served();
    const issuer = await served();
    const server = await served({ authorizationServers: [named.origin] });

    await sourceOf(server, secretAuth(issuer), globalThis.fetch, { discovery: 'from_the_issuer' }).source.token();

    expect([issuer.tokenRequests(), named.tokenRequests(), server.tokenRequests()]).toEqual([1, 0, 0]);
  });

  it('sends its credentials to no issuer whose own metadata names another issuer, and asks for no token', async () => {
    const issuer = await served({ issuer: 'https://elsewhere.example.com' });
    const server = await served({ authorizationServers: [issuer.origin] });
    const { source } = sourceOf(server, secretAuth(issuer), globalThis.fetch, { discovery: 'from_the_issuer' });

    await expect(source.token()).rejects.toBeInstanceOf(IssuerMismatchError);
    expect([issuer.tokenRequests(), server.tokenRequests()]).toEqual([0, 0]);
  });
});
