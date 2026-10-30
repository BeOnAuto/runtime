import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { memoryLedger } from '@on.auto/operations/testing';
import { custodianRefusal } from '@on.auto/secrets/testing';
import type { ClientRegistrations, RegistrationPlace } from '@on.auto/tool-servers';
import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptSecrets } from '../testing/harness-services.ts';
import { sealedInMemory } from '../testing/sealed-connections.ts';
import { clientRegistrationsStream, makeClientRegistrations, RegistrationEventSchema } from './client-registrations.ts';

const accounts = 'https://accounts.example.com';

const atAccounts: RegistrationPlace = { issuer: accounts, server: null };

const atLogin: RegistrationPlace = { issuer: 'https://login.example.net', server: null };

const forFiles: RegistrationPlace = { issuer: accounts, server: 'https://mcp.files.example.com' };

const forNotes: RegistrationPlace = { issuer: accounts, server: 'https://mcp.notes.example.com' };

function registrationOf(clientId: string) {
  return { clientId, registration: Redacted.make(JSON.stringify({ client_id: clientId })) };
}

function clientIdOf(found: { readonly clientId: string } | undefined): string | undefined {
  return found?.clientId;
}

function kept(registrations: ClientRegistrations, ...ids: readonly (readonly [RegistrationPlace, string])[]) {
  return Effect.runPromise(
    Effect.forEach(ids, ([place, clientId]) => registrations.keep(place, registrationOf(clientId)), {
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
    const before = await Effect.runPromise(registrations.latestAt(atAccounts));
    await kept(registrations, [atAccounts, 'one'], [atAccounts, 'two'], [atLogin, 'three']);

    expect(before).toBeUndefined();
    expect(
      await Promise.all([
        Effect.runPromise(registrations.latestAt(atAccounts)).then(clientIdOf),
        Effect.runPromise(registrations.named(accounts, 'one')).then(clientIdOf),
        Effect.runPromise(registrations.named(accounts, 'three')).then(clientIdOf),
        Effect.runPromise(registrations.latestAt(atLogin)).then(clientIdOf),
      ]),
    ).toEqual(['two', 'one', undefined, 'three']);
  });

  it('are kept apart for each server given by hand at an issuer, and apart from the ways of providers there', async () => {
    const ledger = memoryLedger();
    const registrations = makeClientRegistrations({ registry: ledger.service, secrets: keptSecrets({}) });
    await kept(registrations, [atAccounts, 'one'], [forFiles, 'two'], [atAccounts, 'three']);

    expect(
      await Promise.all(
        [atAccounts, forFiles, forNotes].map((place) =>
          Effect.runPromise(registrations.latestAt(place)).then(clientIdOf),
        ),
      ),
    ).toEqual(['three', 'two', undefined]);
    expect(await Effect.runPromise(registrations.named(accounts, 'two')).then(clientIdOf)).toBe('two');
  });

  it('keep a registration made again as the latest at its issuer', async () => {
    const registrations = makeClientRegistrations({ registry: memoryLedger().service, secrets: keptSecrets({}) });
    await kept(registrations, [atAccounts, 'one'], [atAccounts, 'two'], [atAccounts, 'one']);

    const latest = await Effect.runPromise(registrations.latestAt(atAccounts));

    expect([clientIdOf(latest), registrationTextOf(latest)]).toEqual(['one', '{"client_id":"one"}']);
  });

  it('are none whose row the secret store no longer keeps', async () => {
    const secrets = keptSecrets({});
    const registrations = makeClientRegistrations({ registry: memoryLedger().service, secrets });
    await kept(registrations, [atAccounts, 'one'], [atAccounts, 'two']);
    await Effect.runPromise(secrets.forget('secret-1'));

    expect(await Effect.runPromise(registrations.named(accounts, 'one'))).toBeUndefined();
  });
});

describe('the clients the runtime registered itself, in a secret store that cannot answer now', () => {
  it('fail in the words of the store where it cannot read their row now, by issuer and by issuer and id alike', async () => {
    const { custodian, store } = sealedInMemory();
    const registrations = makeClientRegistrations({ registry: memoryLedger().service, secrets: store });
    await kept(registrations, [atAccounts, 'one']);

    custodian.refuse();
    const failures = await Effect.runPromise(
      Effect.all([Effect.flip(registrations.latestAt(atAccounts)), Effect.flip(registrations.named(accounts, 'one'))]),
    );

    const words = `The custodian of the key ${custodian.kid} refused to unwrap a data key: ${custodianRefusal}`;
    expect(failures).toMatchObject([
      { _tag: 'custodian_refused', detail: words },
      { _tag: 'custodian_refused', detail: words },
    ]);
  });

  it('fail in the words of the store where it cannot keep a registration now, and record nothing', async () => {
    const { custodian, store } = sealedInMemory();
    const ledger = memoryLedger();
    const registrations = makeClientRegistrations({ registry: ledger.service, secrets: store });

    custodian.refuse();
    const failure = await Effect.runPromise(Effect.flip(registrations.keep(atAccounts, registrationOf('one'))));

    expect(failure).toMatchObject({
      _tag: 'custodian_refused',
      detail: `The custodian of the key ${custodian.kid} refused to wrap a data key: ${custodianRefusal}`,
    });
    expect(ledger.streamNames()).not.toContain(clientRegistrationsStream);
  });
});

describe('the facts of the registrations of clients', () => {
  recordedFactsBehaviour({
    schema: RegistrationEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.46.0': [
        {
          type: 'client_registered',
          data: { ...forFiles, client_id: 'client-1', secret_id: 'secret-1' },
          context: { at: '2026-10-29T10:00:00.000Z', by: 'runtime' },
        },
      ],
    },
  });
});
