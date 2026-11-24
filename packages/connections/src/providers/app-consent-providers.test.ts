import { drive, providersOf } from '@on.auto/providers/testing';
import type { ConsentClientOptions } from '@on.auto/tool-servers';
import { autoClientsOf, fakeConsentServiceInProcess, registeredAt } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { adding } from '../testing/additions.ts';
import { ada, harness, operationNamed } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const [signingIn] = drive.credentials;

const forTheCompany = {
  ...drive,
  credentials: [
    ...drive.credentials,
    { ...signingIn, permissions: 'application', description: 'Allow Auto once for every account of your company.' },
  ],
};

const issuer = 'https://accounts.drive.example.com';

const unstated = registeredAt(issuer);

const actingAsTheApp = registeredAt(issuer, { clientId: 'drive-for-the-company', permissions: 'application' });

function harnessOf(entry: unknown, consenting: Readonly<Partial<ConsentClientOptions>>) {
  return harness({ providers: providersOf(entry), consenting });
}

function listedWith(entry: unknown, consenting: Readonly<Partial<ConsentClientOptions>>) {
  const h = harnessOf(entry, consenting);
  return h.call(operationNamed(h.operations, 'list_providers'), ada);
}

function throughAutosClientForTheApp(listing: { readonly awaitingApproval?: true } = {}) {
  const service = fakeConsentServiceInProcess({
    vendor: { origin: issuer },
    now: () => 0,
    permissions: 'application',
    ...listing,
  });
  closing.push(service.close);
  return { autoClients: autoClientsOf(service) };
}

describe('a provider whose way of consent acts as the app, where no client set up here states its permissions', () => {
  it('lists its other ways exactly as without that way', async () => {
    const consenting = { registeredClients: [unstated] };

    expect([await listedWith(forTheCompany, {}), await listedWith(forTheCompany, consenting)]).toEqual([
      await listedWith(drive, {}),
      await listedWith(drive, consenting),
    ]);
  });

  it('adds the way the entry names first, as without that way', async () => {
    expect(
      await adding(harnessOf(forTheCompany, { registeredClients: [unstated] }), { provider: 'drive' }),
    ).toMatchObject({
      status: 'succeeded',
      output: { status: 'pending', permissions: 'delegated', credential: { kind: 'authorization', issuer } },
    });
  });
});

describe('a provider whose way of consent acts as the app, where a client set up here states its permissions', () => {
  it('lists that way after the way the entry names first, through the registered client', async () => {
    expect(await listedWith(forTheCompany, { registeredClients: [unstated, actingAsTheApp] })).toMatchObject({
      output: {
        providers: [
          {
            name: 'drive',
            credentials: [
              { kind: 'authorization', permissions: 'delegated', offered: true, client_source: 'registered' },
              { kind: 'authorization', permissions: 'application', offered: true, client_source: 'registered' },
            ],
          },
        ],
      },
    });
  });

  it('lists that way through Auto’s client where the consent service lists one with application permissions, which serves no other way', async () => {
    expect(await listedWith(forTheCompany, throughAutosClientForTheApp())).toMatchObject({
      output: {
        providers: [
          {
            name: 'drive',
            credentials: [
              { kind: 'authorization', permissions: 'application', offered: true, client_source: 'auto' },
              { kind: 'authorization', permissions: 'delegated', offered: true, oauth_client: 'required' },
            ],
          },
        ],
      },
    });
  });
});

describe('a provider whose way of consent acts as the app under the organization’s own OAuth client', () => {
  it('is listed where no client is set up here, since it takes none of them', async () => {
    const requiringItsOwn = {
      ...drive,
      credentials: [{ ...signingIn, permissions: 'application', oauth_client: 'required' }],
    };

    expect(await listedWith(requiringItsOwn, {})).toMatchObject({
      output: {
        providers: [
          {
            name: 'drive',
            credentials: [
              { kind: 'authorization', permissions: 'application', offered: true, oauth_client: 'required' },
            ],
          },
        ],
      },
    });
  });
});

const awaiting = { awaitingApproval: true } as const;

const markOf = (way: number) => ['output', 'providers', 0, 'credentials', way, 'awaiting_approval'];

describe('a provider whose way of consent takes a client of Auto’s that its vendor has not yet approved', () => {
  it('marks the way that takes the client where the consent service lists it as awaiting, and no other way', async () => {
    const listed = await listedWith(forTheCompany, throughAutosClientForTheApp(awaiting));

    expect(listed).toMatchObject({
      output: {
        providers: [
          {
            credentials: [
              { permissions: 'application', client_source: 'auto', awaiting_approval: true },
              { permissions: 'delegated', oauth_client: 'required' },
            ],
          },
        ],
      },
    });
    expect(listed).not.toHaveProperty(markOf(1));
  });

  it('marks no way where the consent service lists no such fact', async () => {
    const listed = await listedWith(forTheCompany, throughAutosClientForTheApp());

    expect(listed).not.toHaveProperty(markOf(0));
    expect(listed).not.toHaveProperty(markOf(1));
  });

  it.each([
    ['takes another way that acts as someone first', awaiting, 'delegated'],
    ['takes the way first in the order, as without the fact', {}, 'application'],
  ] as const)(
    'where the consent service marks the client, an addition that names no way %s',
    async (_, listing, taken) => {
      expect(
        await adding(harnessOf(forTheCompany, throughAutosClientForTheApp(listing)), { provider: 'drive' }),
      ).toMatchObject({ status: 'succeeded', output: { status: 'pending', permissions: taken } });
    },
  );

  it('takes that way where no other way is offered, as it would without the fact', async () => {
    const theAppAlone = { ...drive, credentials: [{ ...signingIn, permissions: 'application' }] };

    expect(
      await adding(harnessOf(theAppAlone, throughAutosClientForTheApp(awaiting)), { provider: 'drive' }),
    ).toMatchObject({
      status: 'succeeded',
      output: { status: 'pending', permissions: 'application', credential: { kind: 'authorization', issuer } },
    });
  });
});
