import { generateKeyPairSync } from 'node:crypto';

import { Effect, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted } from '../authorization-testing/authorization-requests.ts';
import {
  consentClientWith,
  finishAskedOf,
  memoryRegistrations,
  registeredAt,
  servedForConsent,
  startAskedAt,
  tokensKeptBy,
  type ClientRegistration,
  type FakeMcpServer,
} from '../testing/index.ts';
import type { RegisteredClient } from './client-sources.ts';
import type { ConsentClient, FinishAsked, FinishedConsent, StartAsked } from './consent-client.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await servedForConsent(changes);
  closing.push(fake.close);
  return fake;
}

function finished(client: ConsentClient, asked: FinishAsked): Promise<FinishedConsent> {
  return Effect.runPromise(client.finish(asked).pipe(Effect.provide(TestClock.layer())));
}

async function finishedAt(client: ConsentClient, asked: StartAsked): Promise<FinishedConsent> {
  return finished(client, await finishAskedOf(client, asked));
}

function refused(client: ConsentClient, asked: FinishAsked) {
  return Effect.runPromise(Effect.flip(client.finish(asked)));
}

function failingTokens(...[address, init]: readonly [unknown, unknown?]): Promise<Response> {
  return String(address).endsWith('/token')
    ? Promise.resolve(new Response('failing', { status: 500 }))
    : globalThis.fetch(String(address), Object.assign({}, init));
}

const aToken: unknown = expect.stringMatching(/^token-/u);

const aRefreshToken: unknown = expect.stringMatching(/^refresh-/u);

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function keyedAt(issuer: string): RegisteredClient {
  return registeredAt(issuer, {
    credential: { kind: 'private_key', privateKey: Redacted.make(keys.privateKey), algorithm: 'RS256' },
  });
}

function openAt(issuer: string): RegisteredClient {
  return registeredAt(issuer, { credential: { kind: 'public' }, tokenEndpointAuthMethod: 'none' });
}

interface Revoked {
  readonly fake: FakeMcpServer;
  readonly done: FinishedConsent;
}

describe('the finish of a consent', () => {
  it('redeems the code with the verifier and the client it started with, and answers the tokens as one value and the scope granted', async () => {
    const fake = await served();
    const client = consentClientWith({ registeredClients: [registeredAt(fake.origin)] });

    const done = await finishedAt(client, startAskedAt(fake));
    const kept = tokensKeptBy(done);

    expect(kept).toEqual({
      access_token: aToken,
      refresh_token: aRefreshToken,
      expires_at: '1970-01-01T01:00:00.000Z',
      scope: 'files.read',
      token_type: 'Bearer',
    });
    expect(done.scope).toBe('files.read');
    expect(await admitted(fake, kept.access_token)).toBe(true);
    expect(Redacted.isRedacted(done.tokens)).toBe(true);
  });

  it('answers the scope the server granted where it is narrower than asked, and none where none was asked or granted', async () => {
    const narrower = await served({ grantedScope: 'files.read' });
    const lasting = await served({ expiresInSeconds: null });
    const client = consentClientWith({
      registeredClients: [registeredAt(narrower.origin), registeredAt(lasting.origin)],
    });

    const granted = await finishedAt(client, startAskedAt(narrower, { scope: 'files.read files.write' }));
    const ungranted = await finishedAt(client, startAskedAt(lasting, { scope: undefined }));

    expect([granted.scope, tokensKeptBy(granted).scope, ungranted.scope]).toEqual([
      'files.read',
      'files.read',
      undefined,
    ]);
    expect(Object.keys(tokensKeptBy(ungranted))).toEqual(['access_token', 'refresh_token', 'token_type']);
  });
});

describe('a finish refused before the code is redeemed', () => {
  it('is refused for an issuer that is not the server’s, or none where the server sends one', async () => {
    const fake = await served();
    const client = consentClientWith({ registeredClients: [registeredAt(fake.origin)] });
    const asked = await finishAskedOf(client, startAskedAt(fake));

    expect([
      await refused(client, { ...asked, iss: 'https://elsewhere.example.com' }),
      await refused(client, { ...asked, iss: undefined }),
    ]).toEqual([{ refused: 'iss' }, { refused: 'iss' }]);
    expect(tokensKeptBy(await finished(client, asked)).token_type).toBe('Bearer');
  });
});

describe('a finish whose code is not redeemed', () => {
  it('is refused for a code the server refuses, as one already redeemed or one of another verifier', async () => {
    const fake = await served();
    const client = consentClientWith({ registeredClients: [registeredAt(fake.origin)] });
    const asked = await finishAskedOf(client, startAskedAt(fake));
    const another = await finishAskedOf(client, startAskedAt(fake));
    await finished(client, asked);
    const otherVerifier = Redacted.make('another-verifier-of-forty-three-characters-long');

    expect([await refused(client, asked), await refused(client, { ...another, verifier: otherVerifier })]).toEqual([
      { refused: 'code' },
      { refused: 'code' },
    ]);
  });

  it('is unanswered where the token endpoint fails', async () => {
    const fake = await served();
    const client = consentClientWith({ fetch: failingTokens, registeredClients: [registeredAt(fake.origin)] });

    expect(await refused(client, await finishAskedOf(client, startAskedAt(fake)))).toEqual({ refused: 'unanswered' });
  });
});

describe('the registered client a finish redeems the code with', () => {
  it('is the client the start chose, with a key or with neither a secret nor a key', async () => {
    const keyed = await served({ clientSecret: undefined, publicKey: keys.publicKey });
    const open = await served({ clientSecret: undefined });
    const keyedClient = consentClientWith({ registeredClients: [keyedAt(keyed.origin)] });
    const openClient = consentClientWith({ registeredClients: [openAt(open.origin)] });

    const withKey = await finishedAt(keyedClient, startAskedAt(keyed));
    const withNothing = await finishedAt(openClient, startAskedAt(open));

    expect([
      await admitted(keyed, tokensKeptBy(withKey).access_token),
      await admitted(open, tokensKeptBy(withNothing).access_token),
    ]).toEqual([true, true]);
  });

  it('is refused as gone where whoever runs the runtime no longer registers it at the issuer', async () => {
    const fake = await served();
    const starting = consentClientWith({ registeredClients: [registeredAt(fake.origin)] });
    const asked = await finishAskedOf(starting, startAskedAt(fake));
    const renamed = consentClientWith({ registeredClients: [registeredAt(fake.origin, { clientId: 'renamed' })] });

    expect([await refused(renamed, asked), await refused(consentClientWith(), asked)]).toEqual([
      { refused: 'client_gone' },
      { refused: 'client_gone' },
    ]);
  });
});

describe('the other clients a finish redeems the code with', () => {
  it('is the registration the start made dynamically, found by its id, and gone where it is not kept', async () => {
    const fake = await served({ dynamicRegistration: true });
    const client = consentClientWith({ registrations: memoryRegistrations() });
    const asked = await finishAskedOf(client, startAskedAt(fake, { clients: ['dynamic'] }));

    const done = await finished(client, asked);

    expect(await admitted(fake, tokensKeptBy(done).access_token)).toBe(true);
    expect(await refused(consentClientWith(), asked)).toEqual({ refused: 'client_gone' });
  });

  it('is the metadata document while the public address is the one the start named it at', async () => {
    const fake = await served({ clientMetadataDocuments: true });
    const publicUrl = 'https://runtime.example.com';
    const asked = startAskedAt(fake, { clients: ['metadata_document'] });
    const start = await Effect.runPromise(consentClientWith({ publicUrl }).start(asked));
    const { server, way, returnAddress, reaches } = asked;
    const unredeemed = { code: 'a code nobody redeems', iss: 'https://elsewhere.example.com' };
    const finishing: FinishAsked = {
      server,
      way,
      returnAddress,
      reaches,
      client: start.client,
      verifier: start.verifier,
      ...unredeemed,
    };

    expect([
      await refused(consentClientWith({ publicUrl }), finishing),
      await refused(consentClientWith({ publicUrl: 'https://moved.example.com' }), finishing),
    ]).toEqual([{ refused: 'iss' }, { refused: 'client_gone' }]);
  });
});

describe('the revocation a finish offers', () => {
  it('revokes the refresh token, and with it every token of its grant, with the client of the connection', async () => {
    const secret = await served();
    const keyed = await served({ clientSecret: undefined, publicKey: keys.publicKey });
    const open = await served({ clientSecret: undefined });
    const fakes = [secret, keyed, open];
    const client = consentClientWith({
      registeredClients: [registeredAt(secret.origin), keyedAt(keyed.origin), openAt(open.origin)],
    });

    const revoked = await Promise.all(
      fakes.map(async (fake): Promise<Revoked> => ({ fake, done: await finishedAt(client, startAskedAt(fake)) })),
    );
    await Promise.all(revoked.map(({ done }) => Effect.runPromise(done.revoked)));

    expect(await Promise.all(revoked.map(({ fake, done }) => admitted(fake, tokensKeptBy(done).access_token)))).toEqual(
      [false, false, false],
    );
  });

  it('revokes the access token where the server gave no refresh token, and nothing where the server names no revocation endpoint', async () => {
    const unrefreshed = await served({ issuesRefreshTokens: false });
    const unrevoking = await served({ publishesMetadata: false });
    const client = consentClientWith({
      registeredClients: [registeredAt(unrefreshed.origin), registeredAt(unrevoking.origin)],
    });
    const endpoints = {
      authorization_endpoint: `${unrevoking.origin}/authorize`,
      token_endpoint: `${unrevoking.origin}/token`,
    };

    const accessOnly = await finishedAt(client, startAskedAt(unrefreshed));
    const kept = await finishedAt(client, startAskedAt(unrevoking, endpoints));
    await Effect.runPromise(Effect.andThen(accessOnly.revoked, kept.revoked));

    expect(Object.keys(tokensKeptBy(accessOnly))).toEqual(['access_token', 'expires_at', 'scope', 'token_type']);
    expect(await admitted(unrefreshed, tokensKeptBy(accessOnly).access_token)).toBe(false);
    expect(await admitted(unrevoking, tokensKeptBy(kept).access_token)).toBe(true);
    expect(unrevoking.heard().filter(({ path }) => path === '/revoke')).toEqual([]);
  });
});
