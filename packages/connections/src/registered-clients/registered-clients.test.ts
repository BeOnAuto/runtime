import { generateKeyPairSync } from 'node:crypto';

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
});

const scopesUnnamed =
  'Expected scopes, the scopes the client may ask, since another registered client names one of its issuers too, a trailing slash aside: a client that names none would serve every way there that no client before it covers, and a client after it never';

describe('the scopes of a registered client', () => {
  it('are read where a client names them, and left out of a client that may ask any', () => {
    const reading = { ...withASecret, scopes: ['files.read'] };
    const sending = {
      ...publicClient,
      issuers: ['https://accounts.example.com/'],
      scopes: ['mail.send', 'files.read'],
    };

    expect(clientsOf(reading, sending, withAKey).map(({ clientId, scopes }) => ({ clientId, scopes }))).toEqual([
      { clientId: '1234.apps.example.com', scopes: ['files.read'] },
      { clientId: 'auto-runtime', scopes: ['mail.send', 'files.read'] },
      { clientId: '9f1c', scopes: undefined },
    ]);
  });

  it('are named by each client at an issuer another client names, a trailing slash aside, whichever stands first', () => {
    const sharing = { ...publicClient, issuers: ['https://other.example.com', 'https://accounts.example.com/'] };

    expect([
      refusalOf(withASecret, { ...sharing, scopes: ['files.read'] }),
      refusalOf({ ...withASecret, scopes: ['files.read'] }, sharing),
      refusalOf(withASecret, withAKey, sharing),
    ]).toEqual([
      `${prefix}/scopes: ${scopesUnnamed}`,
      `The connection settings are invalid. CONNECTIONS: /registered_clients/1/scopes: ${scopesUnnamed}`,
      `${prefix}/scopes: ${scopesUnnamed}; CONNECTIONS: /registered_clients/2/scopes: ${scopesUnnamed}`,
    ]);
    expect(clientsOf(withASecret, { ...publicClient, issuers: ['https://accounts.example.com/other'] })).toHaveLength(
      2,
    );
  });

  it('are one at least, each written out and not empty', () => {
    expect([
      refusalOf({ ...withASecret, scopes: [] }),
      refusalOf({ ...withASecret, scopes: ['files.read', ''] }),
      refusalOf({ ...withASecret, scopes: ['${EXAMPLE_SCOPE}'] }),
    ]).toEqual([
      `${prefix}/scopes: Expected at least one scope the client may ask; leave scopes out for a client that may ask any`,
      `${prefix}/scopes/1: Expected a value with a length of at least 1`,
      `${prefix}/scopes/0: Holds a reference to an environment variable, which only the client_secret and the private_key of a registered client may hold`,
    ]);
  });
});

describe('the permissions of a registered client', () => {
  it('leave scopes unnamed where the other client at the issuer states other permissions, which are delegated where left out', () => {
    const sharing = { ...publicClient, issuers: ['https://accounts.example.com/'] };
    const withPermissions = (permissions: string) => ({ ...sharing, permissions });

    expect([
      clientsOf(withASecret, withPermissions('application')).map(({ clientId, permissions }) => ({
        clientId,
        permissions,
      })),
      refusalOf(withASecret, withPermissions('delegated')),
      refusalOf({ ...withASecret, permissions: 'application' }, withPermissions('application')),
    ]).toEqual([
      [
        { clientId: '1234.apps.example.com', permissions: undefined },
        { clientId: 'auto-runtime', permissions: 'application' },
      ],
      `${prefix}/scopes: ${scopesUnnamed}; CONNECTIONS: /registered_clients/1/scopes: ${scopesUnnamed}`,
      `${prefix}/scopes: ${scopesUnnamed}; CONNECTIONS: /registered_clients/1/scopes: ${scopesUnnamed}`,
    ]);
  });

  it('are read as stated, application or delegated, left out where it states none, and refused otherwise', () => {
    expect([
      clientsOf(
        { ...withASecret, permissions: 'application' },
        { ...withAKey, permissions: 'delegated' },
        publicClient,
      ).map(({ permissions }) => permissions),
      refusalOf({ ...withASecret, permissions: 'admin' }).startsWith(`${prefix}/permissions: `),
    ]).toEqual([['application', 'delegated', undefined], true]);
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

const asAnApplication = {
  ...withASecret,
  application: {
    private_key: '${EXAMPLE_PRIVATE_KEY}',
    install_page: 'https://accounts.example.com/apps/auto/installations/new',
  },
};

describe('the application of a registered client', () => {
  it('is read with its private key from its reference, redacted, and the page where it is installed', () => {
    const [client] = clientsOf(asAnApplication);

    expect(client?.application?.installPage).toBe(asAnApplication.application.install_page);
    expect(JSON.stringify(client)).not.toMatch(/PRIVATE KEY/u);
    expect(registeredClientSecrets(clientsOf(asAnApplication)).map((secret) => Redacted.value(secret))).toEqual([
      environment.EXAMPLE_CLIENT_SECRET,
      environment.EXAMPLE_PRIVATE_KEY,
    ]);
  });

  it('is read with a private key in PKCS #1 rewrapped in PKCS #8, which the signer takes', () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const connections = JSON.stringify({ registered_clients: [asAnApplication] });
    const read = Effect.runSync(
      readConnectionsSetting({ ...environment, EXAMPLE_PRIVATE_KEY: privateKey, CONNECTIONS: connections }),
    );
    const kept = registeredClientSecrets(read.registeredClients).map((secret) => Redacted.value(secret));

    expect(kept.map((secret) => secret.split('\n')[0])).toEqual([
      environment.EXAMPLE_CLIENT_SECRET,
      '-----BEGIN PRIVATE KEY-----',
    ]);
  });

  it.each([
    ['a page that is no https address', { install_page: 'http://accounts.example.com/install' }, 'install_page'],
    ['a page with a placeholder', { install_page: 'https://accounts.example.com/{app}/install' }, 'install_page'],
    ['a page that holds a reference', { install_page: 'https://accounts.example.com/${EXAMPLE_APP}' }, 'install_page'],
    ['a private key that is no reference', { private_key: 'not a reference' }, 'private_key'],
    ['a private key whose variable is not set', { private_key: '${EXAMPLE_UNSET_KEY}' }, 'private_key'],
  ] as const)('is refused with %s, at its place', (_case, changes, field) => {
    const application = { ...asAnApplication.application, ...changes };

    expect(refusalOf({ ...asAnApplication, application })).toContain(`${prefix}/application/${field}`);
  });
});
