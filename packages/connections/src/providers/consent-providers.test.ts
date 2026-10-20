import { adverts, drive, providersOf } from '@on.auto/providers/testing';
import type { ConsentClientOptions } from '@on.auto/tool-servers';
import {
  autoClientsOf,
  clockAt,
  consentClientWith,
  registeredAt,
  serveFakeConsentService,
  type FakeConsentService,
} from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { makeProviderOffering } from '../index.ts';
import { connectionPolicyOf, type ConnectionPolicyFields } from '../policy/connection-policy.ts';
import { added, adding } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const consentProviders = providersOf(adverts, drive);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const registeredClients = [
  registeredAt('https://accounts.drive.example.com'),
  registeredAt('https://login.adverts.example.com/{tenant}/v2.0'),
];

function consentHarness(policy: ConnectionPolicyFields = {}): Harness {
  return harness({
    providers: consentProviders,
    policy: connectionPolicyOf(policy),
    consenting: { registeredClients },
  });
}

const driveConsent = {
  kind: 'authorization',
  issuer: 'https://accounts.drive.example.com',
  scope: 'files.read files.write',
  parameters: { access_type: 'offline', prompt: 'consent' },
};

const byConsent =
  'The connection drive is connected by signing in to its provider and allowing Auto, which its page starts';

describe('a connection added by a provider whose way is consent', () => {
  it('is recorded pending with the way of consent as its credential, which holds no secret', async () => {
    const h = consentHarness();

    const answer = await adding(h, { provider: 'drive' });

    expect(answer).toMatchObject({
      status: 'succeeded',
      output: { name: 'drive', status: 'pending', credential: driveConsent, credential_ends_with: null },
    });
    expect((await h.facts())[0]?.data).toMatchObject({ credential: driveConsent });
  });

  it('carries the endpoints of the way with each value in its place, and its client sources', async () => {
    expect(await adding(consentHarness(), { provider: 'adverts', placeholders: { tenant: 'acme' } })).toMatchObject({
      output: {
        credential: {
          kind: 'authorization',
          issuer: 'https://login.adverts.example.com/acme/v2.0',
          authorization_endpoint: 'https://login.adverts.example.com/acme/oauth2/v2.0/authorize',
          token_endpoint: 'https://login.adverts.example.com/acme/oauth2/v2.0/token',
          revocation_endpoint: 'https://login.adverts.example.com/acme/oauth2/v2.0/revoke',
          clients: ['registered', 'dynamic'],
        },
      },
    });
  });

  it('is refused where the rules take no host of its endpoints, or not the kind', async () => {
    const tenant = { provider: 'adverts', placeholders: { tenant: 'acme' }, credential: { kind: 'authorization' } };

    expect([
      await adding(consentHarness({ allowed_hosts: ['adverts.example.com', 'api.adverts.example.com'] }), tenant),
      await adding(consentHarness({ credential_kinds: ['secret'] }), { provider: 'drive' }),
    ]).toEqual([
      {
        status: 'rejected',
        reason: 'forbidden',
        detail:
          'A connection may not reach the host login.adverts.example.com on this runtime, which allows adverts.example.com and api.adverts.example.com',
      },
      {
        status: 'rejected',
        reason: 'forbidden',
        detail: 'A connection may not take an authorization credential on this runtime, which allows secret',
      },
    ]);
  });
});

describe('a connection added by a provider whose way is consent, by its name alone', () => {
  it('takes the first way the listing offers, consent where whoever runs Auto registered a client and the rules take its hosts, and another way otherwise', async () => {
    const byName = { provider: 'adverts', placeholders: { tenant: 'acme' } };
    const consentOutOfReach = { allowed_hosts: ['adverts.example.com', 'api.adverts.example.com'] };

    expect([
      await adding(consentHarness(), byName),
      await adding(consentHarness(consentOutOfReach), byName),
    ]).toMatchObject([
      { status: 'succeeded', output: { credential: { kind: 'authorization' } } },
      { status: 'succeeded', output: { credential: { kind: 'secret', in: 'header', name: 'X-Api-Key' } } },
    ]);
  });
});

describe('a connection whose way is consent', () => {
  it('is neither approved nor given a credential on the page', async () => {
    const h = consentHarness();
    const { id, token } = await added(h, { provider: 'drive' });

    expect([
      await h.call(operationNamed(h.operations, 'approve'), ada, { id, token }),
      await h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value: 'a pasted secret' }),
    ]).toEqual([
      { status: 'rejected', reason: 'conflict', detail: byConsent },
      { status: 'rejected', reason: 'conflict', detail: byConsent },
    ]);
  });
});

describe('a provider whose way is consent, as the page lists it', () => {
  it('lists the way by its kind, its issuer, its scope and its description, and nothing else of it', async () => {
    const h = consentHarness();

    const listed = await h.call(operationNamed(h.operations, 'list_providers'), ada);

    expect(listed).toMatchObject({
      output: {
        providers: [
          { name: 'adverts', credentials: [{ kind: 'authorization' }, { kind: 'secret' }] },
          {
            name: 'drive',
            credentials: [
              {
                kind: 'authorization',
                issuer: 'https://accounts.drive.example.com',
                scope: 'files.read files.write',
                description: 'Sign in to Drive and allow Auto to read and change your files.',
                offered: true,
              },
            ],
          },
        ],
      },
    });
    expect(listed).not.toHaveProperty('output.providers.1.credentials.0.parameters');
  });

  it('is not listed where the rules leave the kind out and it takes no other way', async () => {
    const h = consentHarness({ credential_kinds: ['secret'] });

    const listed = await h.call(operationNamed(h.operations, 'list_providers'), ada);

    expect(listed).toMatchObject({ output: { providers: [{ name: 'adverts', credentials: [{ kind: 'secret' }] }] } });
  });
});

const unsetUp =
  'The provider drive takes consent through a client whoever runs Auto registers, which is not set up here';

describe('a provider whose way is consent where whoever runs Auto registered no client the way takes', () => {
  it('is refused an addition at the kind of its credential', async () => {
    const h = harness({ providers: consentProviders });

    expect(await adding(h, { provider: 'drive' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/credential/kind', detail: unsetUp }],
    });
  });

  it('is listed with the way not offered, because whoever runs Auto sets it up, and a way that registers dynamically offered', async () => {
    const h = harness({ providers: consentProviders });

    const listed = await h.call(operationNamed(h.operations, 'list_providers'), ada);

    expect(listed).toMatchObject({
      output: {
        providers: [
          {
            name: 'adverts',
            credentials: [
              { kind: 'authorization', offered: true },
              { kind: 'secret', offered: true },
            ],
          },
          { name: 'drive', credentials: [{ kind: 'authorization', offered: false, because: unsetUp }] },
        ],
      },
    });
  });
});

describe('a connection of consent given by hand', () => {
  it('is refused at the kind of its credential, in words that say consent is a provider’s way and how to name one', async () => {
    const byHand = {
      name: 'files',
      type: 'mcp',
      entry: { url: 'https://files.example.com/mcp' },
      credential: { kind: 'authorization', issuer: 'https://accounts.files.example.com' },
    };

    expect(await adding(harness(), byHand)).toMatchObject({
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/credential/kind',
          detail:
            'Expected another kind: consent is offered through a provider alone, so name the provider, as search lists it, in provider',
        },
      ],
    });
  });
});

function offeredWith(consenting: Partial<ConsentClientOptions>) {
  return Effect.runPromise(
    makeProviderOffering({
      providers: providersOf(drive),
      providerValues: new Map(),
      policy: connectionPolicyOf({}),
      access: 'people',
      consent: consentClientWith(consenting),
    })(ada),
  );
}

const driveOffered = { name: 'drive', title: 'Drive', description: 'Read and change the files of an account.' };

describe('the providers search offers a caller who may add', () => {
  it('leave out a provider whose way of consent takes no client the runtime has, and take it in once one is registered', async () => {
    expect([await offeredWith({}), await offeredWith({ registeredClients })]).toEqual([[], [driveOffered]]);
  });
});

async function serviceOfDrive(): Promise<FakeConsentService> {
  const service = await serveFakeConsentService({
    vendor: { origin: 'https://accounts.drive.example.com' },
    now: clockAt(0).now,
  });
  closing.push(service.close);
  return service;
}

function switchedOf(service: FakeConsentService, enabled: boolean): Partial<ConsentClientOptions> {
  return { autoClients: { ...autoClientsOf(service), enabled } };
}

describe('a provider whose way is consent where Auto’s consent service serves its issuer', () => {
  it('is listed offered, added and offered to search, where whoever runs Auto registered no client', async () => {
    const service = await serviceOfDrive();
    const h = harness({ providers: consentProviders, consenting: switchedOf(service, true) });

    expect([
      await h.call(operationNamed(h.operations, 'list_providers'), ada),
      await adding(h, { provider: 'drive' }),
      await offeredWith(switchedOf(service, true)),
    ]).toMatchObject([
      { output: { providers: [{ name: 'adverts' }, { name: 'drive', credentials: [{ offered: true }] }] } },
      { status: 'succeeded', output: { status: 'pending', credential: { kind: 'authorization' } } },
      [driveOffered],
    ]);
  });

  it('is set up first, and the service asked nothing, where the source of Auto is switched off', async () => {
    const service = await serviceOfDrive();
    const h = harness({ providers: consentProviders, consenting: switchedOf(service, false) });

    expect([
      await h.call(operationNamed(h.operations, 'list_providers'), ada),
      await adding(h, { provider: 'drive' }),
      await offeredWith(switchedOf(service, false)),
    ]).toMatchObject([
      {
        output: {
          providers: [{ name: 'adverts' }, { name: 'drive', credentials: [{ offered: false, because: unsetUp }] }],
        },
      },
      { status: 'rejected', issues: [{ pointer: '/credential/kind', detail: unsetUp }] },
      [],
    ]);
    expect(service.calls()).toEqual([]);
  });
});
