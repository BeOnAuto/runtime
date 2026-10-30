import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted } from '../authorization-testing/authorization-requests.ts';
import {
  consentClientWith,
  finishAskedOf,
  registeredAt,
  startAskedAt,
  tokensKeptBy,
  type ClientRegistration,
} from '../testing/index.ts';
import { servedForConsent, type FakeMcpServer } from '../testing/served-fakes.ts';
import type { ConsentClient, FinishedConsent, StartAsked } from './consent-client.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await servedForConsent(changes);
  closing.push(fake.close);
  return fake;
}

function clientAt(fake: FakeMcpServer): ConsentClient {
  return consentClientWith({ registeredClients: [registeredAt(fake.origin)] });
}

async function scopeAsked(fake: FakeMcpServer, asked: StartAsked): Promise<string | null> {
  const start = await Effect.runPromise(clientAt(fake).start(asked));
  return new URL(start.url).searchParams.get('scope');
}

async function finishedAt(client: ConsentClient, asked: StartAsked): Promise<FinishedConsent> {
  const finishing = await finishAskedOf(client, asked);
  return Effect.runPromise(client.finish(finishing).pipe(Effect.provide(TestClock.layer())));
}

async function refusedAt(client: ConsentClient, asked: StartAsked) {
  return Effect.runPromise(Effect.flip(client.finish(await finishAskedOf(client, asked))));
}

const offline = ['files.read', 'offline_access'];

interface Revocable {
  readonly fake: FakeMcpServer;
  readonly finished: FinishedConsent;
}

describe('the scope a start asks for', () => {
  it('gains offline_access where the metadata it discovered lists it, once, and never where nothing was asked', async () => {
    const listing = await served({ scopesSupported: offline });

    expect([
      await scopeAsked(listing, startAskedAt(listing)),
      await scopeAsked(listing, startAskedAt(listing, { scope: 'files.read offline_access' })),
      await scopeAsked(listing, startAskedAt(listing, { scope: undefined })),
    ]).toEqual(['files.read offline_access', 'files.read offline_access', null]);
  });

  it('is the scope of the way alone where the way gives its endpoints, since no metadata is read', async () => {
    const listing = await served({ scopesSupported: offline });
    const endpoints = {
      authorization_endpoint: `${listing.origin}/authorize`,
      token_endpoint: `${listing.origin}/token`,
      revocation_endpoint: `${listing.origin}/revoke`,
    };

    expect(await scopeAsked(listing, startAskedAt(listing, endpoints))).toBe('files.read');
  });
});

describe('the scope a finish answers', () => {
  it('is the granted scope with its scopes separated by single spaces, kept so with the tokens', async () => {
    const spaced = await served({ grantedScope: '  files.read \t files.write ' });
    const done = await finishedAt(clientAt(spaced), startAskedAt(spaced, { scope: 'files.read files.write' }));

    expect([done.scope, tokensKeptBy(done).scope]).toEqual(['files.read files.write', 'files.read files.write']);
  });

  it('is the granted scope with its scopes separated by single spaces where the server separates them with commas', async () => {
    const commas = await served({ grantedScope: 'files.read,files.write, files.share' });
    const done = await finishedAt(clientAt(commas), startAskedAt(commas, { scope: 'files.read files.write' }));

    expect([done.scope, tokensKeptBy(done).scope]).toEqual([
      'files.read files.write files.share',
      'files.read files.write files.share',
    ]);
  });

  it('is refused as no scope where the server grants an empty one to a scope asked, or as malformed where it is not a scope, revoking the tokens', async () => {
    const empty = await served({ grantedScope: '' });
    const quoted = await served({ grantedScope: 'files."read"' });

    expect([
      await refusedAt(clientAt(empty), startAskedAt(empty)),
      await refusedAt(clientAt(quoted), startAskedAt(quoted)),
    ]).toEqual([{ refused: 'no_scope' }, { refused: 'malformed_scope' }]);
    expect(empty.heard().filter(({ path }) => path === '/revoke')).toHaveLength(1);
    expect(quoted.heard().filter(({ path }) => path === '/revoke')).toHaveLength(1);
  });

  it('is none where the server grants an empty scope to a way that asks none, and the tokens are kept with none', async () => {
    const empty = await served({ grantedScope: '' });
    const done = await finishedAt(clientAt(empty), startAskedAt(empty, { scope: undefined }));

    expect([done.scope, tokensKeptBy(done).scope]).toEqual([undefined, undefined]);
    expect(empty.heard().filter(({ path }) => path === '/revoke')).toEqual([]);
  });
});

describe('the end of the tokens a finish keeps', () => {
  it('is left out where the server gives one no clock can hold', async () => {
    const endless = await served({ expiresInSeconds: 1e300 });

    expect(Object.keys(tokensKeptBy(await finishedAt(clientAt(endless), startAskedAt(endless))))).toEqual([
      'access_token',
      'refresh_token',
      'scope',
      'token_type',
    ]);
  });
});

describe('the revocation of a client with a secret', () => {
  it('sends the secret in the form where the server takes it there alone, as its revocation methods say or else its token endpoint’s', async () => {
    const listing = await served({ takesBasicSecrets: false });
    const unlisting = await served({ takesBasicSecrets: false, listsRevocationMethods: false });
    const fakes = [listing, unlisting];

    const done = await Promise.all(
      fakes.map(async (fake): Promise<Revocable> => ({
        fake,
        finished: await finishedAt(clientAt(fake), startAskedAt(fake)),
      })),
    );
    await Effect.runPromise(Effect.all(done.map(({ finished }) => finished.revoked)));

    expect(
      await Promise.all(done.map(({ fake, finished }) => admitted(fake, tokensKeptBy(finished).access_token))),
    ).toEqual([false, false]);
  });

  it('sends the secret in the Basic header where the way gives the endpoints and so no methods are known', async () => {
    const fake = await served({ publishesMetadata: false });
    const endpoints = {
      authorization_endpoint: `${fake.origin}/authorize`,
      token_endpoint: `${fake.origin}/token`,
      revocation_endpoint: `${fake.origin}/revoke`,
    };
    const done = await finishedAt(clientAt(fake), startAskedAt(fake, endpoints));

    await Effect.runPromise(done.revoked);

    expect(await admitted(fake, tokensKeptBy(done).access_token)).toBe(false);
  });
});
