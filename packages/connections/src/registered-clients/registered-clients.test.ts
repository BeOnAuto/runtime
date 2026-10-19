import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { readConnectionsSetting } from '../policy/connection-policy.ts';
import { registeredClientSecrets } from './registered-clients.ts';

const environment = {
  EXAMPLE_CLIENT_SECRET: 'example-client-secret-5f2a',
  EXAMPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----example-----END PRIVATE KEY-----',
};

const withASecret = {
  issuers: ['https://accounts.example.com'],
  client_id: '1234.apps.example.com',
  client_secret: '${EXAMPLE_CLIENT_SECRET}',
};

const withAKey = {
  issuers: ['https://login.example.net/common/v2.0', 'https://login.example.net/{tenant}/v2.0'],
  client_id: '9f1c',
  private_key: '${EXAMPLE_PRIVATE_KEY}',
  algorithm: 'RS256',
};

const publicClient = {
  issuers: ['http://127.0.0.1:8443'],
  client_id: 'auto-runtime',
  token_endpoint_auth_method: 'none',
};

function clientsOf(...clients: readonly object[]) {
  const connections = JSON.stringify({ registered_clients: clients });
  return Effect.runSync(readConnectionsSetting({ ...environment, CONNECTIONS: connections })).registeredClients;
}

function refusalOf(...clients: readonly object[]): string {
  const connections = JSON.stringify({ registered_clients: clients });
  return Effect.runSync(Effect.flip(readConnectionsSetting({ ...environment, CONNECTIONS: connections }))).message;
}

const prefix = 'The connection settings are invalid. CONNECTIONS: /registered_clients/0';

describe('a registered client', () => {
  it('is read with its issuers as written, its client id and its secret, its key or neither, each secret redacted', () => {
    const clients = clientsOf(withASecret, withAKey, publicClient);

    expect(
      clients.map(({ issuers, clientId, credential, tokenEndpointAuthMethod }) => ({
        issuers,
        clientId,
        kind: credential.kind,
        tokenEndpointAuthMethod,
      })),
    ).toEqual([
      {
        issuers: withASecret.issuers,
        clientId: '1234.apps.example.com',
        kind: 'client_secret',
        tokenEndpointAuthMethod: null,
      },
      { issuers: withAKey.issuers, clientId: '9f1c', kind: 'private_key', tokenEndpointAuthMethod: null },
      { issuers: publicClient.issuers, clientId: 'auto-runtime', kind: 'public', tokenEndpointAuthMethod: 'none' },
    ]);
    expect(clients[1]?.credential).toMatchObject({ algorithm: 'RS256' });
    expect(JSON.stringify(clients)).not.toMatch(/example-client-secret|PRIVATE KEY/u);
    expect(registeredClientSecrets(clients).map((secret) => Redacted.value(secret))).toEqual([
      environment.EXAMPLE_CLIENT_SECRET,
      environment.EXAMPLE_PRIVATE_KEY,
    ]);
  });
});

describe('the issuers of a registered client', () => {
  it('are one at least, each an https URL or an http URL on a loopback address, a placeholder in its place', () => {
    expect(refusalOf({ ...withASecret, issuers: [] })).toBe(
      `${prefix}/issuers: Expected at least one issuer, an authorization server the client is registered at`,
    );
    expect(
      refusalOf({
        ...withASecret,
        issuers: ['https://accounts.example.com', 'http://accounts.example.com', '{scheme}://example.com'],
      }),
    ).toBe(
      [
        `${prefix}/issuers/1: Expected an https URL, or an http URL on a loopback address, written out up to its host, with each placeholder in its place`,
        'CONNECTIONS: /registered_clients/0/issuers/2: Expected an https URL, or an http URL on a loopback address, written out up to its host, with each placeholder in its place',
      ].join('; '),
    );
  });

  it('are the issuers of one client, two that differ by a trailing slash alone being one issuer', () => {
    expect(
      refusalOf(
        withASecret,
        { ...publicClient, issuers: ['https://other.example.com', 'https://accounts.example.com/'] },
        {
          ...withAKey,
          issuers: ['https://accounts.example.com'],
        },
      ),
    ).toBe(
      [
        'The connection settings are invalid. CONNECTIONS: /registered_clients/1/issuers/1: Names an issuer an earlier registered client names too, a trailing slash aside; register each issuer under one client',
        'CONNECTIONS: /registered_clients/2/issuers/0: Names an issuer an earlier registered client names too, a trailing slash aside; register each issuer under one client',
      ].join('; '),
    );
    expect(clientsOf(withASecret, { ...publicClient, issuers: ['https://accounts.example.com/other'] })).toHaveLength(
      2,
    );
  });
});

describe('the credential of a registered client', () => {
  it('is a client secret or a private key with its algorithm, or neither, and no method its kind does not authenticate with', () => {
    const withoutASecret = { issuers: withASecret.issuers, client_id: withASecret.client_id };

    expect([
      refusalOf({ ...withASecret, private_key: '${EXAMPLE_PRIVATE_KEY}', algorithm: 'RS256' }),
      refusalOf({ ...withAKey, algorithm: undefined }),
      refusalOf({ ...withoutASecret, algorithm: 'RS256' }),
      refusalOf({ ...withASecret, token_endpoint_auth_method: 'private_key_jwt' }),
      refusalOf({ ...withAKey, token_endpoint_auth_method: 'client_secret_post' }),
      refusalOf({ ...withoutASecret, token_endpoint_auth_method: 'client_secret_basic' }),
    ]).toEqual([
      `${prefix}/private_key: Expected client_secret or private_key, not both: a client authenticates with one`,
      `${prefix}/algorithm: Expected algorithm, the signing algorithm of private_key, such as RS256`,
      `${prefix}/algorithm: Expected no algorithm: it signs with private_key, which the client does not give`,
      `${prefix}/token_endpoint_auth_method: Expected client_secret_basic or client_secret_post, which a client with a client secret authenticates with`,
      `${prefix}/token_endpoint_auth_method: Expected private_key_jwt, which a client with a private key authenticates with`,
      `${prefix}/token_endpoint_auth_method: Expected none, which a public client authenticates with`,
    ]);
    expect(clientsOf({ ...withASecret, token_endpoint_auth_method: 'client_secret_post' })).toMatchObject([
      { tokenEndpointAuthMethod: 'client_secret_post' },
    ]);
  });
});

describe('the client id and the algorithm of a registered client', () => {
  it('are refused empty, each at its place', () => {
    expect(refusalOf({ ...withASecret, client_id: '' }, { ...withAKey, algorithm: '' })).toBe(
      [
        `${prefix}/client_id: Expected a value with a length of at least 1`,
        'CONNECTIONS: /registered_clients/1/algorithm: Expected a value with a length of at least 1',
      ].join('; '),
    );
  });
});
