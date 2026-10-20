import { Duration, Effect, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConsentClient } from '../consent/consent-client.ts';
import {
  autoClientsOf,
  consentClientWith,
  registeredAt,
  servedThroughAuto,
  startAskedAt,
  studioBase,
  type FakeConsentService,
  type ThroughAuto,
} from '../testing/index.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';
import { unlistedWords, type ReturnKind } from './auto-clients.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function throughAuto(): Promise<ThroughAuto> {
  const serving = await servedThroughAuto();
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
    const { fake, service } = await throughAuto();
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
    const { fake, service } = await throughAuto();
    const bounds: number[] = [];
    const requestTimeout = (ms: number) => {
      bounds.push(ms);
      return AbortSignal.timeout(ms);
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
    const { fake, service } = await throughAuto();
    const client = consentClientWith({ autoClients: { ...autoClientsOf(service), enabled: false } });

    const sources = await Effect.runPromise(sourcesAt(client, fake.origin));
    const start = await Effect.runPromise(Effect.flip(client.start(startAskedAt(fake))));

    expect([sources, start]).toEqual([[], { refused: 'no_client' }]);
    expect(service.calls()).toEqual([]);
  });
});

describe('the clients of Auto’s consent service for a Studio neither hosted nor on this computer', () => {
  it('are left out of the sources had, and never asked for', async () => {
    const { fake, service } = await throughAuto();
    const elsewhere: ReturnKind = 'elsewhere';
    const client = consentClientWith({ autoClients: autoClientsOf(service, elsewhere) });

    expect(await Effect.runPromise(sourcesAt(client, fake.origin))).toEqual([]);
    expect(service.calls()).toEqual([]);
  });
});

describe('a start at an issuer both a registered client and Auto’s consent service serve', () => {
  it('takes the registered client, and asks the service for nothing but its clients', async () => {
    const { fake, service } = await throughAuto();
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
