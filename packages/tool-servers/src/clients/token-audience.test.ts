import type { FetchLike } from '@modelcontextprotocol/client';
import { Function, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { MintingAuth } from '../settings/server-settings.ts';
import type { ClientRegistration } from '../testing/index.ts';
import { serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';
import { tokenSource, type Discovery } from './token-source.ts';

const clientSecret = 'graph-client-secret-81c2';

const audience = 'https://graph.example.com/mcp';

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

function authOf(issuer: FakeMcpServer, changes: Partial<MintingAuth> = {}): MintingAuth {
  return {
    issuer: issuer.origin,
    client_id: 'playbook',
    scope: null,
    credential: { kind: 'client_secret', client_secret: Redacted.make(clientSecret) },
    ...changes,
  };
}

function recordingFetch() {
  const bodies: Record<string, string>[] = [];
  const recording: FetchLike = async (...[address, init]: readonly [unknown, unknown?]) => {
    const request = new Request(String(address), Object.assign({}, init));
    if (request.url.endsWith('/token')) {
      bodies.push(Object.fromEntries(new URLSearchParams(await request.clone().text())));
    }
    return globalThis.fetch(request);
  };
  return { fetch: recording, bodies: () => [...bodies] };
}

function tokenOf(server: FakeMcpServer, settings: MintingAuth, fetch: FetchLike, discovery: Discovery) {
  return tokenSource(settings, {
    server: 'graph',
    serverUrl: server.url,
    discovery,
    fetch,
    now: Date.now,
    minted: Function.constVoid,
  }).token();
}

describe('discovery from the issuer', () => {
  it('asks the issuer for the token even when the metadata of the server names another authorization server', async () => {
    const named = await served();
    const issuer = await served();
    const server = await served({ authorizationServers: [named.origin] });

    await tokenOf(server, authOf(issuer), globalThis.fetch, 'from_the_issuer');

    expect(issuer.tokenRequests()).toBe(1);
    expect(named.tokenRequests()).toBe(0);
  });
});

describe('the audience of a token request', () => {
  it('is left out when the auth block names none, and the resource is sent', async () => {
    const fake = await served();
    const recording = recordingFetch();

    await tokenOf(fake, authOf(fake), recording.fetch, 'from_the_server');

    expect(recording.bodies()).toMatchObject([{ resource: fake.url }]);
    expect(recording.bodies()).not.toHaveProperty('0.audience');
  });

  it('is sent in place of the resource, with the scope, when the auth block names both', async () => {
    const fake = await served();
    const recording = recordingFetch();

    await tokenOf(fake, authOf(fake, { audience, scope: 'graph.read' }), recording.fetch, 'from_the_server');

    expect(recording.bodies()).toMatchObject([{ grant_type: 'client_credentials', audience, scope: 'graph.read' }]);
    expect(recording.bodies()).not.toHaveProperty('0.resource');
  });

  it('is sent in place of the resource with no scope when the auth block names none', async () => {
    const fake = await served();
    const recording = recordingFetch();

    await tokenOf(fake, authOf(fake, { audience }), recording.fetch, 'from_the_server');

    expect(recording.bodies()).toMatchObject([{ audience }]);
    expect(recording.bodies()).not.toHaveProperty('0.resource');
    expect(recording.bodies()).not.toHaveProperty('0.scope');
  });
});
