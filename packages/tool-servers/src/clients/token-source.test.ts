import { generateKeyPairSync } from 'node:crypto';

import { Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { secretsOf } from '../bounds/secrets.ts';
import type { AuthSettings } from '../settings/server-settings.ts';
import { serveFakeMcp, type ClientRegistration, type FakeMcpServer } from '../testing/index.ts';
import { tokenSource } from './token-source.ts';

const clientSecret = 'graph-client-secret-81c2';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function authorizationServer(client: ClientRegistration): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ client });
  closing.push(fake.close);
  return fake;
}

function rsaKeys() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function secretAuth(fake: FakeMcpServer, changes: Partial<AuthSettings> = {}): AuthSettings {
  return {
    issuer: fake.origin,
    client_id: 'playbook',
    scope: null,
    credential: { kind: 'client_secret', client_secret: Redacted.make(clientSecret) },
    ...changes,
  };
}

function sourceOf(fake: FakeMcpServer, settings: AuthSettings) {
  const clock = { now: Date.parse('2026-10-05T09:00:00.000Z') };
  const minted: (readonly [string, string])[] = [];
  const secrets = secretsOf([]);
  const source = tokenSource(settings, {
    server: 'graph',
    serverUrl: fake.url,
    discovery: 'from_the_server',
    fetch: globalThis.fetch,
    now: () => clock.now,
    minted: (server, token) => {
      minted.push([server, token]);
      secrets.replace(server, token);
    },
  });
  return { source, clock, minted, secrets };
}

describe('the tokens of an auth block', () => {
  it('mints one token for every concurrent caller', async () => {
    const fake = await authorizationServer({ clientId: 'playbook', clientSecret, expiresInSeconds: 120 });
    const { source, minted } = sourceOf(fake, secretAuth(fake, { scope: 'graph.read' }));

    const tokens = await Promise.all([source.token(), source.token(), source.token()]);

    expect(new Set(tokens).size).toBe(1);
    expect(minted).toEqual([['graph', tokens[0]]]);
    expect(fake.tokenRequests()).toBe(1);
  });

  it('renews a token a minute before it expires, or halfway through a shorter life', async () => {
    const fake = await authorizationServer({ clientId: 'playbook', clientSecret, expiresInSeconds: 120 });
    const { source, clock } = sourceOf(fake, secretAuth(fake));

    const first = await source.token();
    clock.now += 59_000;
    const beforeRenewal = await source.token();
    clock.now += 1000;
    const renewed = await source.token();

    expect(beforeRenewal).toBe(first);
    expect(renewed).not.toBe(first);
    expect(fake.tokenRequests()).toBe(2);
  });

  it('keeps a token whose lifetime is unsaid for an hour less a minute', async () => {
    const fake = await authorizationServer({ clientId: 'playbook', clientSecret, expiresInSeconds: null });
    const { source, clock } = sourceOf(fake, secretAuth(fake));

    const first = await source.token();
    clock.now += 3_539_000;
    const kept = await source.token();
    clock.now += 1000;
    const renewed = await source.token();

    expect(kept).toBe(first);
    expect(renewed).not.toBe(first);
  });
});

describe('the tokens a source mints among the secrets', () => {
  it('replace the token before them on renewal, which still scrubs until the next renewal', async () => {
    const fake = await authorizationServer({ clientId: 'playbook', clientSecret, expiresInSeconds: 120 });
    const { source, clock, secrets } = sourceOf(fake, secretAuth(fake));

    const first = await source.token();
    clock.now += 60_000;
    const renewed = await source.token();
    const afterRenewal = secrets.scrub(`${first} ${renewed}`);
    clock.now += 60_000;
    const renewedAgain = await source.token();

    expect([afterRenewal, secrets.scrub(`${first} ${renewed} ${renewedAgain}`)]).toEqual([
      '[redacted] [redacted]',
      `${first} [redacted] [redacted]`,
    ]);
  });

  it('replace the token the server refused, which still scrubs until the next one is refused', async () => {
    const fake = await authorizationServer({ clientId: 'playbook', clientSecret, expiresInSeconds: 3600 });
    const { source, secrets } = sourceOf(fake, secretAuth(fake));

    const refused = await source.token();
    await source.onUnauthorized();
    const replacing = await source.token();
    const afterRefusal = secrets.scrub(`${refused} ${replacing}`);
    await source.onUnauthorized();
    const replacingAgain = await source.token();

    expect([afterRefusal, secrets.scrub(`${refused} ${replacing} ${replacingAgain}`)]).toEqual([
      '[redacted] [redacted]',
      `${refused} [redacted] [redacted]`,
    ]);
  });
});

describe('minting a token again, and with a private key', () => {
  it('mints a new token when the server refuses the one it holds', async () => {
    const fake = await authorizationServer({ clientId: 'playbook', clientSecret, expiresInSeconds: 3600 });
    const { source } = sourceOf(fake, secretAuth(fake));

    const first = await source.token();
    await source.onUnauthorized();

    expect(await source.token()).not.toBe(first);
    expect(fake.tokenRequests()).toBe(2);
  });

  it('signs a client assertion with a private key', async () => {
    const { publicKey, privateKey } = rsaKeys();
    const fake = await authorizationServer({ clientId: 'playbook', publicKey, expiresInSeconds: 3600 });
    const { source } = sourceOf(
      fake,
      secretAuth(fake, {
        credential: { kind: 'private_key', private_key: Redacted.make(privateKey), algorithm: 'RS256' },
      }),
    );

    expect(await source.token()).toMatch(/^token-1-/u);
  });

  it('fails when its private key is not the one the authorization server knows', async () => {
    const fake = await authorizationServer({
      clientId: 'playbook',
      publicKey: rsaKeys().publicKey,
      expiresInSeconds: 3600,
    });
    const { source } = sourceOf(
      fake,
      secretAuth(fake, {
        credential: { kind: 'private_key', private_key: Redacted.make(rsaKeys().privateKey), algorithm: 'RS256' },
      }),
    );

    await expect(source.token()).rejects.toThrow('invalid_client');
  });
});

describe('an authorization server that refuses', () => {
  it('sends its credentials to no issuer but the one pinned', async () => {
    const fake = await authorizationServer({
      clientId: 'playbook',
      clientSecret,
      expiresInSeconds: 3600,
      issuer: 'https://elsewhere.example.com',
    });
    const { source } = sourceOf(fake, secretAuth(fake));

    await expect(source.token()).rejects.toThrow(/^Issuer mismatch in authorization server metadata/u);
    expect(fake.tokenRequests()).toBe(0);
  });

  it('sends its credentials to no other authorization server, even one consistent with itself', async () => {
    const elsewhere = await authorizationServer({ clientId: 'playbook', clientSecret, expiresInSeconds: 3600 });
    const fake = await authorizationServer({
      clientId: 'playbook',
      clientSecret,
      expiresInSeconds: 3600,
      authorizationServer: elsewhere.origin,
    });
    const { source } = sourceOf(fake, secretAuth(fake));

    await expect(source.token()).rejects.toThrow(/^Authorization server mismatch/u);
    expect(elsewhere.tokenRequests()).toBe(0);
  });

  it('fails when the authorization server refuses the credentials', async () => {
    const fake = await authorizationServer({
      clientId: 'playbook',
      clientSecret: 'another-secret',
      expiresInSeconds: 3600,
    });
    const { source } = sourceOf(fake, secretAuth(fake));

    await expect(source.token()).rejects.toThrow('invalid_client');
  });
});
