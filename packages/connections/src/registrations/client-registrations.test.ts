import { memoryLedger } from '@on.auto/operations/testing';
import { custodianRefusal } from '@on.auto/secrets/testing';
import type { ClientRegistrations } from '@on.auto/tool-servers';
import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptSecrets } from '../testing/harness-services.ts';
import { sealedInMemory } from '../testing/sealed-connections.ts';
import { clientRegistrationsStream, makeClientRegistrations } from './client-registrations.ts';

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

  it('are none whose row the secret store no longer keeps', async () => {
    const secrets = keptSecrets({});
    const registrations = makeClientRegistrations({ registry: memoryLedger().service, secrets });
    await kept(registrations, [accounts, 'one'], [accounts, 'two']);
    await Effect.runPromise(secrets.forget('secret-1'));

    expect(await Effect.runPromise(registrations.named(accounts, 'one'))).toBeUndefined();
  });
});

describe('the clients the runtime registered itself, in a secret store that cannot answer now', () => {
  it('fail in the words of the store where it cannot read their row now, by issuer and by issuer and id alike', async () => {
    const { custodian, store } = sealedInMemory();
    const registrations = makeClientRegistrations({ registry: memoryLedger().service, secrets: store });
    await kept(registrations, [accounts, 'one']);

    custodian.refuse();
    const failures = await Effect.runPromise(
      Effect.all([Effect.flip(registrations.latestAt(accounts)), Effect.flip(registrations.named(accounts, 'one'))]),
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
    const failure = await Effect.runPromise(Effect.flip(registrations.keep(accounts, registrationOf('one'))));

    expect(failure).toMatchObject({
      _tag: 'custodian_refused',
      detail: `The custodian of the key ${custodian.kid} refused to wrap a data key: ${custodianRefusal}`,
    });
    expect(ledger.streamNames()).not.toContain(clientRegistrationsStream);
  });
});
