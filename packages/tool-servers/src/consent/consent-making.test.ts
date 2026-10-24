import { CallFetch } from '@on.auto/operations';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { consentClientWith, memoryRegistrations, registeredAt, startAskedAt } from '../testing/index.ts';
import { servedForConsent } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function readsNothing(): Promise<Response> {
  return Promise.reject(new Error('The client reads nothing through its own fetch'));
}

describe('the fetch a consent client reaches the server of a consent with', () => {
  it('is the fetch the context of the operation gives, not the client its own, so each call of a shell has its own', async () => {
    const fake = await servedForConsent();
    closing.push(fake.close);
    const client = consentClientWith({ fetch: readsNothing, registeredClients: [registeredAt(fake.origin)] });
    const asked: string[] = [];
    const ofTheCall: typeof globalThis.fetch = (...[address, init]: readonly [unknown, unknown?]) => {
      asked.push(String(address));
      return globalThis.fetch(String(address), Object.assign({}, init));
    };

    const start = await Effect.runPromise(
      client.start(startAskedAt(fake)).pipe(Effect.provideService(CallFetch, ofTheCall)),
    );

    expect(new URL(start.url).origin).toBe(fake.origin);
    expect(asked.length).toBeGreaterThan(0);
  });
});

describe('the dynamic registration of a consent client over lent fetches', () => {
  it('is made once for every start at its issuer, whatever fetch each start is lent, since the single flight and the registrations belong to the client', async () => {
    const fake = await servedForConsent({ dynamicRegistration: true });
    closing.push(fake.close);
    const registrations = memoryRegistrations();
    const client = consentClientWith({ registrations });
    const asked = startAskedAt(fake, { clients: ['dynamic'] });
    const lentTo = (fetch: typeof globalThis.fetch) =>
      Effect.runPromise(client.start(asked).pipe(Effect.provideService(CallFetch, fetch)));
    const [one, other] = [
      (...[address, init]: readonly [unknown, unknown?]) => globalThis.fetch(String(address), Object.assign({}, init)),
      (...[address, init]: readonly [unknown, unknown?]) => globalThis.fetch(String(address), Object.assign({}, init)),
    ];

    const starts = await Promise.all([lentTo(one), lentTo(other)]);

    expect(starts.map(({ client: chosen }) => chosen)).toEqual([
      { client_id: 'registered-1', client_source: 'dynamic' },
      { client_id: 'registered-1', client_source: 'dynamic' },
    ]);
    expect(registrations.kept()).toEqual([[fake.origin, 'registered-1']]);
    expect(fake.heard().filter(({ path }) => path === '/register')).toHaveLength(1);
  });
});
