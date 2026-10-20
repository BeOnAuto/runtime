import { custodianRefusal } from '@on.auto/secrets/testing';
import { Effect, Function, Logger } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  consentClientWith,
  memoryRegistrations,
  servedForConsent,
  startAskedAt,
  type ClientRegistration,
  type FakeMcpServer,
} from '../testing/index.ts';
import type { WayClientSource } from './client-sources.ts';
import type { ClientRegistrations, ConsentClient, RegistrationUnavailable, StartAsked } from './consent-client.ts';

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

const documentFirst: readonly WayClientSource[] = ['metadata_document', 'dynamic'];

const publicUrl = 'https://runtime.example.com';

describe('the metadata document a start takes', () => {
  it('is taken where the server advertises it and the public address is https', async () => {
    const documenting = await served({ clientMetadataDocuments: true });

    const taken = await started(
      consentClientWith({ publicUrl }),
      startAskedAt(documenting, { clients: documentFirst }),
    );

    expect(taken.client).toEqual({ client_id: `${publicUrl}/oauth/client.json`, client_source: 'metadata_document' });
    expect(new URL(taken.url).searchParams.get('client_id')).toBe(`${publicUrl}/oauth/client.json`);
  });

  it('is passed over for the next source under an http public address, or at a server that does not advertise it', async () => {
    const documenting = await served({ clientMetadataDocuments: true, dynamicRegistration: true });
    const silent = await served({ dynamicRegistration: true });
    const http = { publicUrl: 'http://127.0.0.1:5555' };

    const underHttp = await started(consentClientWith(http), startAskedAt(documenting, { clients: documentFirst }));
    const atSilent = await started(consentClientWith({ publicUrl }), startAskedAt(silent, { clients: documentFirst }));

    expect([underHttp.client.client_source, atSilent.client.client_source]).toEqual(['dynamic', 'dynamic']);
  });
});

describe('the dynamic registration a start makes', () => {
  it('is made where the server offers it, once for every start at its issuer, and kept', async () => {
    const fake = await served({ dynamicRegistration: true });
    const registrations = memoryRegistrations();
    const client = consentClientWith({ registrations });
    const asked = startAskedAt(fake, { clients: ['dynamic'] });

    const [first, second] = await Promise.all([started(client, asked), started(client, asked)]);
    const later = await started(client, asked);

    expect([first.client, second.client, later.client]).toEqual([
      { client_id: 'registered-1', client_source: 'dynamic' },
      { client_id: 'registered-1', client_source: 'dynamic' },
      { client_id: 'registered-1', client_source: 'dynamic' },
    ]);
    expect(registrations.kept()).toEqual([[fake.origin, 'registered-1']]);
    expect(fake.heard().filter(({ path }) => path === '/register')).toHaveLength(1);
  });
});

describe('a dynamic registration the runtime does not keep', () => {
  it('is one the server refuses, or one whose client id is empty, which the start answers as unanswered', async () => {
    const refusing = await served({ dynamicRegistration: true, refusesRegistration: true });
    const nameless = await served({ dynamicRegistration: true, registeredClientId: '' });
    const registrations = memoryRegistrations();
    const client = consentClientWith({ registrations });

    expect([
      await refused(client, startAskedAt(refusing, { clients: ['dynamic'] })),
      await refused(client, startAskedAt(nameless, { clients: ['dynamic'] })),
    ]).toEqual([{ refused: 'unanswered' }, { refused: 'unanswered' }]);
    expect(registrations.kept()).toEqual([]);
  });

  it('is not reused once its secret has ended, and a new one is made in its place', async () => {
    const fake = await served({ dynamicRegistration: true, registrationSecretSeconds: -60 });
    const registrations = memoryRegistrations();
    const client = consentClientWith({ registrations });
    const asked = startAskedAt(fake, { clients: ['dynamic'] });

    const first = await started(client, asked);
    const second = await started(client, asked);

    expect([first.client.client_id, second.client.client_id]).toEqual(['registered-1', 'registered-2']);
    expect(registrations.kept()).toEqual([
      [fake.origin, 'registered-1'],
      [fake.origin, 'registered-2'],
    ]);
  });
});

function startedLogging(client: ConsentClient, asked: StartAsked, log: (line: string) => void) {
  const logging = Logger.layer([Logger.map(Logger.formatJson, log)]);
  return Effect.runPromise(Effect.result(client.start(asked)).pipe(Effect.provide(logging)));
}

describe('a dynamic registration the secret store cannot read now', () => {
  it('fails the start in the words of the store, and registers nothing', async () => {
    const fake = await served({ dynamicRegistration: true });
    const registrations = memoryRegistrations();
    const client = consentClientWith({ registrations });
    const asked = startAskedAt(fake, { clients: ['dynamic'] });
    await started(client, asked);

    registrations.custodian.refuse();
    const refusal = await refused(consentClientWith({ registrations }), asked);

    expect(refusal).toEqual({
      refused: 'registration_unavailable',
      detail: `The custodian of the key ${registrations.custodian.kid} refused to unwrap a data key: ${custodianRefusal}`,
    });
    expect(fake.heard().filter(({ path }) => path === '/register')).toHaveLength(1);
  });
});

describe('a dynamic registration the secret store cannot keep now', () => {
  it('fails the start in the words of the store, logs its client, and is kept at the next start without registering again', async () => {
    const fake = await served({ dynamicRegistration: true });
    const registrations = memoryRegistrations();
    const client = consentClientWith({ registrations });
    const asked = startAskedAt(fake, { clients: ['dynamic'] });
    const lines: string[] = [];

    registrations.custodian.refuse();
    const failed = await startedLogging(client, asked, (line) => {
      lines.push(line);
    });
    registrations.custodian.answer();
    const later = await started(client, asked);

    const words = `The custodian of the key ${registrations.custodian.kid} refused to wrap a data key: ${custodianRefusal}`;
    expect(failed).toMatchObject({ failure: { refused: 'registration_unavailable', detail: words } });
    expect(lines).toEqual([
      expect.stringContaining(
        `"message":"The client registered at ${fake.origin} as registered-1 cannot be kept now, so this process keeps it at its next consent there: ${words}"`,
      ),
    ]);
    expect(lines.join('\n')).not.toContain('client_secret');
    expect(later.client).toEqual({ client_id: 'registered-1', client_source: 'dynamic' });
    expect(registrations.kept()).toEqual([[fake.origin, 'registered-1']]);
    expect(fake.heard().filter(({ path }) => path === '/register')).toHaveLength(1);
  });

  it('registers again once the client it holds has ended before the store could keep it', async () => {
    const fake = await served({ dynamicRegistration: true, registrationSecretSeconds: -60 });
    const registrations = memoryRegistrations();
    const client = consentClientWith({ registrations });
    const asked = startAskedAt(fake, { clients: ['dynamic'] });

    registrations.custodian.refuse();
    await startedLogging(client, asked, Function.constVoid);
    registrations.custodian.answer();
    const later = await started(client, asked);

    expect(later.client.client_id).toBe('registered-2');
    expect(registrations.kept()).toEqual([[fake.origin, 'registered-2']]);
  });
});

const tooLarge: RegistrationUnavailable = { _tag: 'secret_refused', detail: 'A secret to keep holds more than 8 KiB' };

describe('a dynamic registration the secret store refuses to keep', () => {
  it("fails the start in the refusal's words, logs the client as left unkept, and is not held, so the next start registers again", async () => {
    const fake = await served({ dynamicRegistration: true });
    const registrations: ClientRegistrations = { ...memoryRegistrations(), keep: () => Effect.fail(tooLarge) };
    const client = consentClientWith({ registrations });
    const asked = startAskedAt(fake, { clients: ['dynamic'] });
    const lines: string[] = [];
    const logged = (line: string) => {
      lines.push(line);
    };

    const first = await startedLogging(client, asked, logged);
    const second = await startedLogging(client, asked, logged);

    expect([first, second]).toMatchObject([
      { failure: { refused: 'registration_refused', detail: tooLarge.detail } },
      { failure: { refused: 'registration_refused', detail: tooLarge.detail } },
    ]);
    expect(lines).toEqual([
      expect.stringContaining(
        `"message":"The client registered at ${fake.origin} as registered-1 cannot be kept, so it stays registered there unused: ${tooLarge.detail}"`,
      ),
      expect.stringContaining(`as registered-2 cannot be kept, so it stays registered there unused`),
    ]);
    expect(fake.heard().filter(({ path }) => path === '/register')).toHaveLength(2);
  });
});

describe('a start at a server that takes no client the runtime has', () => {
  it('is refused', async () => {
    const fake = await served();

    expect([
      await refused(consentClientWith(), startAskedAt(fake, { clients: ['dynamic'] })),
      await refused(consentClientWith({ publicUrl }), startAskedAt(fake, { clients: ['metadata_document'] })),
      await refused(consentClientWith(), startAskedAt(fake)),
    ]).toEqual([{ refused: 'no_client' }, { refused: 'no_client' }, { refused: 'no_client' }]);
  });
});
