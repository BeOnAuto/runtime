import { changeCatalogOf } from '@on.auto/operations';
import { Result, Schema, SchemaIssue } from 'effect';
import { describe, expect, it } from 'vitest';

import { clientRegistrationsStream, connectionChanges, connectionsStream, connectionsStreamOfOrg } from '../index.ts';
import { gatewayIssuer } from '../testing/gateway-facts.ts';
import { ConnectionEventSchema } from './connection-events.ts';
import { CredentialSchema } from './credential.ts';

describe('the names of the streams of connections', () => {
  it("are the stream of an org's connections, relative to the org and in full, and the stream of the runtime's client registrations, which a shell routes by them", () => {
    expect([connectionsStream, connectionsStreamOfOrg('acme'), clientRegistrationsStream]).toEqual([
      'connections',
      'org/acme/connections',
      'runtime/client-registrations',
    ]);
  });
});

const decoded = Schema.decodeUnknownResult(ConnectionEventSchema);

function addedWith(provider: string | null, credential: Readonly<Record<string, unknown>>) {
  return {
    type: 'connection_added',
    data: {
      connection: 'connection-1',
      name: 'messages',
      server_type: 'openapi',
      provider,
      placeholders: null,
      entry: { document: 'https://gateway.messages.example.com/openapi.json' },
      credential,
      says: {},
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' },
  };
}

describe('the credential of a connection through a gateway', () => {
  it('is recorded only from a provider’s entry, never given by hand, and places its key under a security scheme', () => {
    const throughIt = {
      kind: 'authorization',
      issuer: gatewayIssuer,
      client_source: 'gateway',
      in: 'security',
      name: 'key',
    };
    const outcomes = [
      addedWith('messages', throughIt),
      addedWith(null, throughIt),
      addedWith('messages', { ...throughIt, in: 'header' }),
      addedWith('messages', { kind: 'authorization', issuer: gatewayIssuer, client_source: 'gateway' }),
      addedWith('messages', { ...throughIt, clients: ['registered'] }),
      addedWith('messages', { ...throughIt, scheme: 'Bearer' }),
    ].map((fact: unknown) => Result.isSuccess(decoded(fact)));
    const byHand = Result.match(decoded(addedWith(null, throughIt)), { onSuccess: () => '', onFailure: String });

    expect(outcomes).toEqual([true, false, false, false, false, false]);
    expect(byHand).toContain(
      "Expected a provider, whose entry alone names the gateway a connection's consent is made through",
    );
  });
});

const decodeCredential = Schema.decodeUnknownResult(CredentialSchema, { errors: 'all' });

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function problemsOf(credential: unknown): readonly (readonly [string, string])[] {
  return Result.match(decodeCredential(credential), {
    onSuccess: () => [],
    onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
      formatIssues(issue).issues.map(({ message, path = [] }): readonly [string, string] => [
        `/${path.map(String).join('/')}`,
        message,
      ]),
  });
}

const issuer = 'https://login.adverts.example.com/acme/v2.0';

const pinned = 'Expected an https URL, or an http URL on a loopback address';

describe('a credential of the kind authorization', () => {
  it('takes the way of its provider, and the client the connection was made with', () => {
    expect(
      problemsOf({
        kind: 'authorization',
        issuer,
        scope: 'adverts.manage',
        parameters: { prompt: 'consent' },
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        revocation_endpoint: `${issuer}/revoke`,
        clients: ['registered'],
        client_id: '9f1c0d2e-example',
        client_source: 'registered',
      }),
    ).toEqual([]);
  });

  it('refuses an issuer or an endpoint that is not pinned, and what the way of its provider refuses', () => {
    expect(
      problemsOf({
        kind: 'authorization',
        issuer: 'http://login.adverts.example.com',
        token_endpoint: 'http://login.adverts.example.com/token',
        parameters: { client_id: 'another' },
      }),
    ).toEqual([
      ['/issuer', pinned],
      ['/token_endpoint', pinned],
      ['/parameters/client_id', 'Expected no client_id, which the runtime sets in every authorization request itself'],
      [
        '/authorization_endpoint',
        'Expected authorization_endpoint beside token_endpoint, since a way gives its authorization and token endpoints together',
      ],
    ]);
  });
});

describe('the fields of a credential of the kind authorization', () => {
  it('are refused to another kind, and those of another kind to it', () => {
    expect([
      problemsOf({ kind: 'authorization', issuer, in: 'header' }),
      problemsOf({ kind: 'secret', in: 'header', name: 'Authorization', client_source: 'dynamic' }),
    ]).toEqual([
      [
        [
          '/in',
          'Expected no in: an authorization credential takes issuer, scope, parameters, authorization_endpoint, token_endpoint, revocation_endpoint, pkce, clients, client_id, and client_source',
        ],
      ],
      [
        [
          '/client_source',
          'Expected no client_source: a secret credential takes name, in, scheme, instructions, key_page, example, and pattern',
        ],
      ],
    ]);
  });
});

const context = { at: '2026-10-05T09:00:00.000Z', by: 'ada' };

const catalog = changeCatalogOf([connectionChanges]);

describe('the change the answer for a connecting makes', () => {
  it('names the connection by its id where it holds the account the connection is in, which a read of the connection answers, and nothing where it holds only the account it acts as', () => {
    const identified = { id: 'm1', stream: 'connections', type: 'connection_identified', context };
    const data = { connection: 'c1', connected_at: context.at, user: { id: 'h-7' } };

    expect([
      catalog.changesOf({ ...identified, data }),
      catalog.changesOf({ ...identified, data: { ...data, account: { id: 'S-0042' } } }),
    ]).toEqual([[], [{ kind: 'connection', connection: 'c1' }]]);
  });
});

const typesThatNameAConnection = [
  'connection_added',
  'connection_way_chosen',
  'connection_client_given',
  'connection_consent_started',
  'connection_connected',
  'connection_broken',
  'connection_app_credential_refused',
  'connection_removed',
  'connection_playbooks_set',
  'connection_account_type_set',
  'connection_signing_secret_set',
  'connection_signing_secret_removed',
  'connection_identified',
  'connection_model_set',
];

describe('the changes the facts of the connections of an org make', () => {
  it('name a connection broken or removed by its id to a caller who may read the org, and nothing for the steps of its consent', () => {
    expect([
      catalog.changesOf({
        id: 'm1',
        stream: 'connections',
        type: 'connection_broken',
        data: { connection: 'c1', kind: 'credential_refused', reason: 'Its server refused the key' },
        context,
      }),
      catalog.changesOf({
        id: 'm1',
        stream: 'connections',
        type: 'connection_removed',
        data: { connection: 'c2' },
        context,
      }),
      catalog.changesOf({
        id: 'm1',
        stream: 'connections',
        type: 'connection_approved',
        data: { connection: 'c1' },
        context,
      }),
      catalog.streamKinds,
      catalog.namedTypes,
      catalog.readableBy({ permissions: ['playbook:read'], playbooks: '*' })({ kind: 'connection', connection: 'c1' }),
    ]).toEqual([
      [{ kind: 'connection', connection: 'c1' }],
      [{ kind: 'connection', connection: 'c2' }],
      [],
      ['connections'],
      typesThatNameAConnection,
      false,
    ]);
  });
});

describe('the change the organization’s own OAuth client makes', () => {
  it('names the connection given it by its id, since its record holds the client id', () => {
    expect(
      catalog.changesOf({
        id: 'm1',
        stream: 'connections',
        type: 'connection_client_given',
        data: { connection: 'c3', client_id: 'org-app', secret_id: 'secret-4' },
        context,
      }),
    ).toEqual([{ kind: 'connection', connection: 'c3' }]);
  });
});

describe('the change a setting of playbooks makes', () => {
  it('names the connection by its id, since its entry then names other playbooks', () => {
    expect(
      catalog.changesOf({
        id: 'm1',
        stream: 'connections',
        type: 'connection_playbooks_set',
        data: { connection: 'c4', playbooks: ['sales'] },
        context,
      }),
    ).toEqual([{ kind: 'connection', connection: 'c4' }]);
  });
});

const appWay = { kind: 'client_credentials', issuer: 'https://a.example.com', permissions: 'application' } as const;

describe('the change a setting of the account type or a choice of the way makes', () => {
  it.each([
    ['connection_account_type_set', { connection: 'c5', account_type: 'service' }],
    ['connection_way_chosen', { connection: 'c5', credential: appWay, says: {} }],
    ['connection_model_set', { connection: 'c5', model: 'acme/fast' }],
  ] as const)('names the connection of %s by its id, since its record then answers another value', (type, data) => {
    expect(catalog.changesOf({ id: 'm1', stream: 'connections', type, data, context })).toEqual([
      { kind: 'connection', connection: 'c5' },
    ]);
  });
});

const started = {
  connection: 'c1',
  state_sha256: 'a1b2',
  verifier_secret_id: 'secret-1',
  client_id: 'auto-runtime',
  client_source: 'registered',
  expires_at: '2026-10-05T09:10:00.000Z',
};

function startedWith(data: Readonly<Record<string, unknown>>) {
  return catalog.changesOf({ id: 'm1', stream: 'connections', type: 'connection_consent_started', data, context });
}

describe('the change a start of a consent makes', () => {
  it('names the connection where the consent asks scopes it had not asked, and nothing where it asks none more or an earlier release recorded it', () => {
    expect([
      startedWith({ ...started, scope: 'files.read files.share', says: { 'files.share': 'Share the files.' } }),
      startedWith({ ...started, scope: 'files.read', says: {} }),
      startedWith(started),
    ]).toEqual([[{ kind: 'connection', connection: 'c1' }], [], []]);
  });
});

describe('the changes a signing secret makes', () => {
  it('name the connection by its id, set or removed, since its record then says whether it holds one', () => {
    expect([
      catalog.changesOf({
        id: 'm1',
        stream: 'connections',
        type: 'connection_signing_secret_set',
        data: { connection: 'c5', secret_id: 'secret-6' },
        context,
      }),
      catalog.changesOf({
        id: 'm1',
        stream: 'connections',
        type: 'connection_signing_secret_removed',
        data: { connection: 'c5', which: 'previous' },
        context,
      }),
    ]).toEqual([[{ kind: 'connection', connection: 'c5' }], [{ kind: 'connection', connection: 'c5' }]]);
  });
});
