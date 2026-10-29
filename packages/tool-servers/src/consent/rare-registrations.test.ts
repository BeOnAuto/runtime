import { Effect, Option, Redacted, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  consentClientWith,
  memoryRegistrations,
  startAskedAt,
  unansweredCall,
  type ClientRegistration,
  type MemoryRegistrations,
} from '../testing/index.ts';
import { servedForConsent, type FakeMcpServer } from '../testing/served-fakes.ts';
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

const registeringOnceInAWhile: Partial<ClientRegistration> = {
  dynamicRegistration: true,
  takesPublicClientsAlone: true,
  registrationsBeforeTheLimit: 1,
};

describe('a public client registered at a server that registers once in a while', () => {
  it('is taken again at every later start, whatever end the server gives a secret it never issued, so the server is asked to register once', async () => {
    const fake = await served({ ...registeringOnceInAWhile, registrationSecretSeconds: -60 });
    const registrations = memoryRegistrations();
    const client = consentClientWith({ registrations });
    const asked = startAskedAt(fake, { clients: ['dynamic'] });

    const first = await started(client, asked);
    const second = await started(client, asked);
    const third = await started(consentClientWith({ registrations }), asked);

    expect([first.client, second.client, third.client]).toEqual([
      { client_id: 'registered-1', client_source: 'dynamic' },
      { client_id: 'registered-1', client_source: 'dynamic' },
      { client_id: 'registered-1', client_source: 'dynamic' },
    ]);
    expect(fake.heard().filter(({ path }) => path === '/register')).toHaveLength(1);
  });

  it('refuses a start that must register past the limit with the host, the step, the status and the wait it names', async () => {
    const fake = await served({ ...registeringOnceInAWhile, registrationRetryAfter: '600' });
    await started(consentClientWith(), startAskedAt(fake, { clients: ['dynamic'] }));

    const unnamedWait = await served(registeringOnceInAWhile);
    await started(consentClientWith(), startAskedAt(unnamedWait, { clients: ['dynamic'] }));

    expect([
      await refused(consentClientWith(), startAskedAt(fake, { clients: ['dynamic'] })),
      await refused(consentClientWith(), startAskedAt(unnamedWait, { clients: ['dynamic'] })),
    ]).toEqual([
      unansweredCall('registration', fake, { status: 429, retryAfterMs: 600_000 }),
      unansweredCall('registration', unnamedWait, { status: 429, retryAfterMs: null }),
    ]);
  });
});

const SecretEndSchema = Schema.fromJsonString(Schema.Struct({ client_secret_expires_at: Schema.Number }));

const aCenturyOn = Date.parse('2126-01-01T00:00:00.000Z');

function startedACenturyOn(client: ConsentClient, asked: StartAsked) {
  return Effect.runPromise(
    Effect.andThen(TestClock.setTime(aCenturyOn), client.start(asked)).pipe(Effect.provide(TestClock.layer())),
  );
}

async function secretEndKeptAt(registrations: MemoryRegistrations, { origin }: FakeMcpServer): Promise<number> {
  const kept = await Effect.runPromise(registrations.latestAt({ issuer: origin, server: null }));
  const registration = Redacted.value(Option.getOrThrow(Option.fromNullishOr(kept)).registration);
  return Schema.decodeUnknownSync(SecretEndSchema)(registration).client_secret_expires_at;
}

function registrationsAt(fake: FakeMcpServer): number {
  return fake.heard().filter(({ path }) => path === '/register').length;
}

describe('a confidential registration whose server names 0 as the end of its secret', () => {
  it('is taken again a century on, since its secret never ends', async () => {
    const fake = await served({ dynamicRegistration: true, registrationsBeforeTheLimit: 1 });
    const registrations = memoryRegistrations();
    const client = consentClientWith({ registrations });
    const asked = startAskedAt(fake, { clients: ['dynamic'] });

    const first = await started(client, asked);
    const later = await startedACenturyOn(client, asked);

    expect(await secretEndKeptAt(registrations, fake)).toBe(0);
    expect([first.client.client_id, later.client.client_id]).toEqual(['registered-1', 'registered-1']);
    expect(registrationsAt(fake)).toBe(1);
  });
});

function authorizedAt(url: string): Promise<number> {
  return fetch(url, { redirect: 'manual' }).then((answer) => answer.status);
}

const anotherReturn = 'https://studio.example.net/connect-return';

describe('a kept registration at a return address the runtime no longer answers at', () => {
  it('is passed over for a registration at the new address, which is kept, since the server refuses the old client there', async () => {
    const fake = await served({ dynamicRegistration: true, takesPublicClientsAlone: true });
    const registrations = memoryRegistrations();
    const client = consentClientWith({ registrations });
    const before = startAskedAt(fake, { clients: ['dynamic'] });
    const after = { ...before, returnAddress: anotherReturn };

    const first = await started(client, before);
    const oldClientThere = new URL(first.url);
    oldClientThere.searchParams.set('redirect_uri', anotherReturn);
    const moved = await started(client, after);
    const again = await started(client, after);

    expect(await authorizedAt(oldClientThere.href)).toBe(400);
    expect([first.client.client_id, moved.client.client_id, again.client.client_id]).toEqual([
      'registered-1',
      'registered-2',
      'registered-2',
    ]);
    expect(await authorizedAt(moved.url)).toBe(302);
    expect(registrations.kept()).toEqual([
      [fake.origin, 'registered-1'],
      [fake.origin, 'registered-2'],
    ]);
  });

  it('is passed over once where it was kept before registrations named their address, and the new one is taken after', async () => {
    const fake = await served({ dynamicRegistration: true, takesPublicClientsAlone: true });
    const registrations = memoryRegistrations();
    const earlier = {
      clientId: 'registered-earlier',
      registration: Redacted.make('{"client_id":"registered-earlier"}'),
    };
    await Effect.runPromise(registrations.keep({ issuer: fake.origin, server: null }, earlier));
    const client = consentClientWith({ registrations });
    const asked = startAskedAt(fake, { clients: ['dynamic'] });

    const first = await started(client, asked);
    const later = await started(client, asked);

    expect([first.client.client_id, later.client.client_id]).toEqual(['registered-1', 'registered-1']);
    expect(registrationsAt(fake)).toBe(1);
  });
});
