import { Duration, Effect, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { ClientsHad, ServiceClient } from '../consent/client-sources.ts';
import type { ConsentClient } from '../consent/consent-client.ts';
import {
  autoClientsOf,
  consentClientWith,
  registeredAt,
  startAskedAt,
  studioBase,
  throughAutoInProcess,
} from '../testing/index.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';
import type { FakeConsentService, ServiceListing, ThroughAuto } from '../testing/served-fakes.ts';
import { awaitsApprovalOf, unlistedWords, type ReturnKind } from './auto-clients.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function throughAuto(listing: ServiceListing = {}): ThroughAuto {
  const serving = throughAutoInProcess({}, listing);
  closing.push(serving.close);
  return serving;
}

function pathsHeardBy(service: FakeConsentService): readonly string[] {
  return service.calls().map(({ path }) => path);
}

function sourcesAt(client: ConsentClient, issuer: string) {
  return Effect.map(client.hadSources(studioBase), ({ sourcesOf }) => sourcesOf({ issuer }));
}

function loggingInto(log: (line: string) => void) {
  return Logger.layer([Logger.map(Logger.formatJson, log)]);
}

const anIssuer = 'https://accounts.example.com';

async function failingOnceAt(): Promise<{ readonly url: string; readonly asked: () => number }> {
  const heard = { times: 0 };
  const listing = await serveOnLoopback(() => () => {
    heard.times += 1;
    return Promise.resolve(
      heard.times === 1
        ? new Response('failing', { status: 503 })
        : Response.json({ clients: [{ issuer: anIssuer, client_id: 'auto-runtime' }] }),
    );
  });
  closing.push(listing.close);
  return { url: listing.origin, asked: () => heard.times };
}

describe('the clients Auto’s consent service lists', () => {
  it('are asked for when first needed, and again once an hour has passed on the test clock', async () => {
    const { fake, service } = throughAuto();
    const sourcesNow = sourcesAt(consentClientWith({ autoClients: autoClientsOf(service) }), fake.origin);

    const sources = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* sourcesNow;
        yield* sourcesNow;
        yield* TestClock.adjust(Duration.minutes(59));
        yield* sourcesNow;
        yield* TestClock.adjust(Duration.minutes(1));
        return [first, yield* sourcesNow];
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(sources).toEqual([['auto'], ['auto']]);
    expect(pathsHeardBy(service)).toEqual(['/clients', '/clients']);
  });

  it('are asked for within five seconds where a request may take longer', async () => {
    const { fake, service } = throughAuto();
    const bounds: number[] = [];
    const requestTimeout = (ms: number) => {
      bounds.push(ms);
      return new AbortController().signal;
    };
    const client = consentClientWith({ autoClients: autoClientsOf(service), requestTimeout });

    await Effect.runPromise(sourcesAt(client, fake.origin));

    expect(bounds).toEqual([5000]);
  });
});

describe('the clients of a consent service that does not answer', () => {
  it('are none for five minutes, which the client says once, naming the service, and asked for again after', async () => {
    const service = await failingOnceAt();
    const client = consentClientWith({ autoClients: autoClientsOf(service) });
    const logged: string[] = [];
    const logging = loggingInto((line) => {
      logged.push(line);
    });

    const sources = await Effect.runPromise(
      Effect.gen(function* () {
        const failed = yield* sourcesAt(client, anIssuer);
        yield* TestClock.adjust(Duration.minutes(4));
        const held = yield* sourcesAt(client, anIssuer);
        yield* TestClock.adjust(Duration.minutes(1));
        return [failed, held, yield* sourcesAt(client, anIssuer)];
      }).pipe(Effect.provide([TestClock.layer(), logging])),
    );

    expect(sources).toEqual([[], [], ['auto']]);
    expect(service.asked()).toBe(2);
    expect(logged).toHaveLength(1);
    expect(logged.join('')).toContain(unlistedWords(service.url));
  });
});

describe('the clients of Auto’s consent service where the source of Auto is switched off', () => {
  it('are never asked for, so no client of Auto’s is taken', async () => {
    const { fake, service } = throughAuto();
    const client = consentClientWith({ autoClients: { ...autoClientsOf(service), enabled: false } });

    const sources = await Effect.runPromise(sourcesAt(client, fake.origin));
    const start = await Effect.runPromise(Effect.flip(client.start(startAskedAt(fake))));

    expect([sources, start]).toEqual([[], { refused: 'no_client' }]);
    expect(service.calls()).toEqual([]);
  });
});

describe('the clients of Auto’s consent service for a Studio neither hosted nor on this computer', () => {
  it('are left out of the sources had, and never asked for', async () => {
    const { fake, service } = throughAuto();
    const elsewhere: ReturnKind = 'elsewhere';
    const client = consentClientWith({ autoClients: autoClientsOf(service, elsewhere) });

    expect(await Effect.runPromise(sourcesAt(client, fake.origin))).toEqual([]);
    expect(service.calls()).toEqual([]);
  });
});

describe('a start at an issuer both a registered client and Auto’s consent service serve', () => {
  it('takes the registered client, and asks the service for nothing but its clients', async () => {
    const { fake, service } = throughAuto();
    const client = consentClientWith({
      registeredClients: [registeredAt(fake.origin)],
      autoClients: autoClientsOf(service),
    });

    const start = await Effect.runPromise(client.start(startAskedAt(fake)));

    expect([start.client, start.state]).toEqual([
      { client_id: 'auto-runtime', client_source: 'registered' },
      'state-1',
    ]);
    expect(pathsHeardBy(service)).toEqual(['/clients']);
  });
});

const hadWith = (awaiting: ServiceClient['awaiting_approval']): ClientsHad => ({
  registeredClients: [],
  publicUrl: undefined,
  serviceClients: [
    { issuer: anIssuer, client_id: 'auto-runtime', ...(awaiting === undefined ? {} : { awaiting_approval: awaiting }) },
  ],
});

async function awaitingWhere(listing: ServiceListing, scope?: string): Promise<readonly boolean[]> {
  const { fake, service } = throughAuto(listing);
  const client = consentClientWith({ autoClients: autoClientsOf(service) });
  const registered = consentClientWith({
    registeredClients: [registeredAt(fake.origin)],
    autoClients: autoClientsOf(service),
  });
  const [ofAuto, ofTheRegistered] = await Promise.all([
    Effect.runPromise(client.hadSources(studioBase)),
    Effect.runPromise(registered.hadSources(studioBase)),
  ]);
  const way = { issuer: fake.origin, scope };
  return [ofAuto.awaitsApproval(way), ofTheRegistered.awaitsApproval(way)];
}

describe('the clients Auto’s consent service lists as awaiting their vendor’s approval', () => {
  it('mark a way whose start takes the client the service lists as awaiting, and no way a registered client serves', async () => {
    expect(await awaitingWhere({ awaitingApproval: true })).toEqual([true, false]);
  });

  it('mark no way where the service lists no such fact of the client', async () => {
    expect(await awaitingWhere({})).toEqual([false, false]);
  });

  it('mark a way that asks a scope the service lists the client as awaiting for, as the service sends it', async () => {
    const listing = { scopes: ['files.read', 'files.write'], awaitingApproval: { scopes: ['files.write'] } };
    expect([...(await awaitingWhere(listing, 'files.write')), ...(await awaitingWhere(listing, 'files.read'))]).toEqual(
      [true, false, false, false],
    );
  });

  it.each([
    { client: 'awaits as a whole', awaiting: true, scope: 'files.read', awaits: true },
    { client: 'awaits for the scope asked', awaiting: { scopes: ['files.write'] }, scope: 'files.write', awaits: true },
    { client: 'awaits for another scope', awaiting: { scopes: ['files.write'] }, scope: 'files.read', awaits: false },
    {
      client: 'awaits for one of the scopes asked',
      awaiting: { scopes: ['files.write'] },
      scope: 'files.read files.write',
      awaits: true,
    },
    {
      client: 'awaits for some scopes, and the way asks none',
      awaiting: { scopes: ['files.write'] },
      scope: undefined,
      awaits: false,
    },
    { client: 'is listed as not awaiting', awaiting: false, scope: 'files.read', awaits: false },
    { client: 'is listed with no such fact', awaiting: undefined, scope: 'files.read', awaits: false },
  ] as const)('mark a way by what it asks where the client $client: $awaits', ({ awaiting, scope, awaits }) => {
    expect(awaitsApprovalOf({ issuer: anIssuer, scope }, hadWith(awaiting))).toBe(awaits);
  });
});

describe('the clients Auto’s consent service lists with the scopes each may ask', () => {
  it('serve a way whose scope they cover, and leave a way they do not cover to be set up first', async () => {
    const { fake, service } = throughAuto({ scopes: ['files.read'] });
    const client = consentClientWith({ autoClients: autoClientsOf(service) });

    const { sourcesOf } = await Effect.runPromise(client.hadSources(studioBase));

    expect([
      sourcesOf({ issuer: fake.origin, scope: 'files.read' }),
      sourcesOf({ issuer: fake.origin, scope: 'files.read mail.send' }),
    ]).toEqual([['auto'], []]);
  });

  it('take a start whose scope the registered client at the issuer does not cover', async () => {
    const { fake, service } = throughAuto({ scopes: ['files.read'] });
    const client = consentClientWith({
      registeredClients: [registeredAt(fake.origin, { scopes: ['mail.send'] })],
      autoClients: autoClientsOf(service),
    });

    const start = await Effect.runPromise(client.start(startAskedAt(fake, { scope: 'files.read' })));

    expect(start.client).toEqual({ client_id: 'auto-runtime', client_source: 'auto' });
    expect(pathsHeardBy(service)).toEqual(['/clients', '/consents']);
  });
});
