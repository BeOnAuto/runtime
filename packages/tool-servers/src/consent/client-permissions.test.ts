import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { statesTheSamePermissions } from './client-permissions.ts';
import {
  registeredClientFor,
  serviceClientFor,
  sourcesHad,
  sourceTakenOf,
  type RegisteredClient,
  type ServiceClient,
  type WayOfClients,
} from './client-sources.ts';

const issuer = 'https://accounts.example.com';

const accounts: RegisteredClient = {
  issuers: [issuer],
  clientId: 'unstated',
  credential: { kind: 'client_secret', clientSecret: Redacted.make('registered-client-secret-7e1d') },
  tokenEndpointAuthMethod: null,
};

const held = {
  unstated: accounts,
  delegated: { ...accounts, clientId: 'delegated', permissions: 'delegated' },
  application: { ...accounts, clientId: 'application', permissions: 'application' },
} satisfies Readonly<Record<string, RegisteredClient>>;

type Held = keyof typeof held;

function listedOf(clients: readonly RegisteredClient[]): readonly ServiceClient[] {
  return clients.map(({ clientId, permissions }) => ({
    issuer,
    client_id: clientId,
    ...(permissions === undefined ? {} : { permissions }),
  }));
}

describe('the permissions a client or a way states', () => {
  it('are delegated where they are left out, and compared as stated otherwise', () => {
    expect([
      statesTheSamePermissions({}, { permissions: 'delegated' }),
      statesTheSamePermissions({}, { permissions: 'application' }),
      statesTheSamePermissions({ permissions: 'application' }, { permissions: 'application' }),
    ]).toEqual([true, false, true]);
  });
});

const rows: readonly (readonly [string, WayOfClients, readonly Held[], Held | undefined])[] = [
  ['a way that states none', { issuer }, ['application', 'unstated'], 'unstated'],
  ['a way that states none', { issuer }, ['application', 'delegated'], 'delegated'],
  ['a way that states none', { issuer }, ['application'], undefined],
  ['a delegated way', { issuer, permissions: 'delegated' }, ['application', 'unstated'], 'unstated'],
  ['a delegated way', { issuer, permissions: 'delegated' }, ['application'], undefined],
  [
    'an application way',
    { issuer, permissions: 'application' },
    ['unstated', 'delegated', 'application'],
    'application',
  ],
  ['an application way', { issuer, permissions: 'application' }, ['unstated', 'delegated'], undefined],
];

describe('the client a way takes by the permissions the way and the client state', () => {
  it.each(rows)(
    'is, for %s among the clients %j, the first at its issuer that states the same permissions, registered or listed by Auto’s consent service, or none',
    (_, way, names, taken) => {
      const clients = names.map((name) => held[name]);

      expect([
        registeredClientFor(clients, way)?.clientId,
        serviceClientFor(listedOf(clients), way)?.client_id,
      ]).toEqual([taken, taken]);
    },
  );
});

describe('the sources a runtime has for a way, by the permissions each client states', () => {
  it('leave a way of the other permissions without a source, also where that client is the only one at the issuer', () => {
    const had = { registeredClients: [], publicUrl: undefined, serviceClients: listedOf([held.application]) };

    expect([
      sourcesHad({ issuer }, had),
      sourceTakenOf({ issuer }, had),
      sourcesHad({ issuer, permissions: 'application' }, had),
      sourcesHad({ issuer, permissions: 'application' }, { ...had, registeredClients: [held.unstated] }),
      sourcesHad({ issuer, permissions: 'application' }, { ...had, registeredClients: [held.application] }),
      sourcesHad(
        { issuer },
        { ...had, serviceClients: listedOf([held.unstated]), registeredClients: [held.application] },
      ),
    ]).toEqual([[], undefined, ['auto'], ['auto'], ['registered', 'auto'], ['auto']]);
  });
});

describe('the registered client of a way that installs an application, by the permissions each states', () => {
  it('is its client registered with the application whatever either states, as before, and never one for another way', () => {
    const installed: RegisteredClient = {
      ...accounts,
      clientId: 'installed',
      application: { privateKey: Redacted.make('application-key-5c2a'), installPage: `${issuer}/apps/example/install` },
    };
    const installing: WayOfClients = { issuer, installs: true, permissions: 'application' };

    expect([
      registeredClientFor([held.application, installed], installing)?.clientId,
      registeredClientFor([held.application], installing),
      registeredClientFor([{ ...installed, permissions: 'application' }], { issuer, permissions: 'application' }),
    ]).toEqual(['installed', undefined, undefined]);
  });
});
