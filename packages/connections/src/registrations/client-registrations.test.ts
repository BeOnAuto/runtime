import { memoryLedger } from '@on.auto/operations/testing';
import type { ClientRegistrations } from '@on.auto/tool-servers';
import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptSecrets } from '../testing/harness-services.ts';
import { makeClientRegistrations } from './client-registrations.ts';

const accounts = 'https://accounts.example.com';

function registrationOf(clientId: string) {
  return { clientId, registration: Redacted.make(JSON.stringify({ client_id: clientId })) };
}

function clientIdOf(found: { readonly clientId: string } | undefined): string | undefined {
  return found?.clientId;
}

function kept(registrations: ClientRegistrations, ...ids: readonly (readonly [string, string])[]) {
  return Effect.runPromise(
    Effect.forEach(ids, ([issuer, clientId]) => registrations.keep(issuer, registrationOf(clientId)), {
      discard: true,
    }),
  );
}

function registrationTextOf(found: { readonly registration: Redacted.Redacted } | undefined) {
  return found === undefined ? undefined : Redacted.value(found.registration);
}

describe('the clients the runtime registered itself', () => {
  it('are found by their issuer, the latest first, and by their issuer and id', async () => {
    const registrations = makeClientRegistrations({ registry: memoryLedger().service, secrets: keptSecrets({}) });
    const before = await Effect.runPromise(registrations.latestAt(accounts));
    await kept(registrations, [accounts, 'one'], [accounts, 'two'], ['https://login.example.net', 'three']);

    expect(before).toBeUndefined();
    expect(
      await Promise.all([
        Effect.runPromise(registrations.latestAt(accounts)).then(clientIdOf),
        Effect.runPromise(registrations.named(accounts, 'one')).then(clientIdOf),
        Effect.runPromise(registrations.named(accounts, 'three')).then(clientIdOf),
        Effect.runPromise(registrations.latestAt('https://login.example.net')).then(clientIdOf),
      ]),
    ).toEqual(['two', 'one', undefined, 'three']);
  });

  it('keep a registration made again as the latest at its issuer', async () => {
    const registrations = makeClientRegistrations({ registry: memoryLedger().service, secrets: keptSecrets({}) });
    await kept(registrations, [accounts, 'one'], [accounts, 'two'], [accounts, 'one']);

    const latest = await Effect.runPromise(registrations.latestAt(accounts));

    expect([clientIdOf(latest), registrationTextOf(latest)]).toEqual(['one', '{"client_id":"one"}']);
  });

  it('are none whose row the secret store no longer keeps or cannot read', async () => {
    const secrets = keptSecrets({});
    const ledger = memoryLedger();
    const registrations = makeClientRegistrations({ registry: ledger.service, secrets });
    const unreadable = makeClientRegistrations({
      registry: ledger.service,
      secrets: { ...secrets, read: () => Effect.fail({ detail: 'The key of the secret is unknown' }) },
    });
    await kept(registrations, [accounts, 'one'], [accounts, 'two']);
    await Effect.runPromise(secrets.forget('secret-1'));

    expect([
      await Effect.runPromise(registrations.named(accounts, 'one')),
      await Effect.runPromise(unreadable.named(accounts, 'two')),
    ]).toEqual([undefined, undefined]);
  });
});
