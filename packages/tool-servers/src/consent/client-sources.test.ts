import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  clientMetadataDocumentOf,
  isSameIssuer,
  metadataDocumentOf,
  registeredClientAt,
  serviceClientAt,
  sourcesHad,
  sourceTakenOf,
  type RegisteredClient,
  type WayOfClients,
} from './client-sources.ts';

const accounts: RegisteredClient = {
  issuers: ['https://accounts.example.com/'],
  clientId: '1234.apps.example.com',
  credential: { kind: 'client_secret', clientSecret: Redacted.make('registered-client-secret-7e1d') },
  tokenEndpointAuthMethod: null,
};

const tenants: RegisteredClient = {
  issuers: ['https://login.example.net/{tenant}/v2.0'],
  clientId: '9f1c0d2e-example',
  credential: { kind: 'public' },
  tokenEndpointAuthMethod: 'none',
};

describe('the issuers of the clients whoever runs the runtime registered', () => {
  it('are the same issuer a trailing slash aside, and nothing else', () => {
    expect([
      isSameIssuer('https://accounts.example.com', 'https://accounts.example.com/'),
      isSameIssuer('https://accounts.example.com/', 'https://accounts.example.com'),
      isSameIssuer('https://accounts.example.com', 'https://accounts.example.com/v2'),
    ]).toEqual([true, true, false]);
  });

  it('find a client by an issuer it names, or by the issuer its template takes with a value in each place', () => {
    const clients = [accounts, tenants];

    expect([
      registeredClientAt(clients, 'https://accounts.example.com')?.clientId,
      registeredClientAt(clients, 'https://login.example.net/acme.example.org/v2.0/')?.clientId,
      registeredClientAt(clients, 'https://login.example.net/{tenant}/v2.0')?.clientId,
      registeredClientAt(clients, 'https://login.example.net/a/b/v2.0'),
      registeredClientAt(clients, 'https://elsewhere.example.com'),
    ]).toEqual(['1234.apps.example.com', '9f1c0d2e-example', '9f1c0d2e-example', undefined, undefined]);
  });
});

describe('the client sources a runtime has for a way', () => {
  const issuer = 'https://accounts.example.com';

  it('are the registered client alone when the way names none, where one is registered at its issuer', () => {
    expect([
      sourcesHad({ issuer }, { registeredClients: [accounts], publicUrl: undefined, serviceClients: [] }),
      sourcesHad({ issuer }, { registeredClients: [tenants], publicUrl: undefined, serviceClients: [] }),
    ]).toEqual([['registered'], []]);
  });

  it('take the metadata document only under an https public address, and dynamic registration always, in the runtime’s order', () => {
    const way: WayOfClients = { issuer, clients: ['registered', 'metadata_document', 'dynamic'] };
    const reversed: WayOfClients = { issuer, clients: ['dynamic', 'registered'] };

    expect([
      sourcesHad(way, { registeredClients: [], publicUrl: 'https://runtime.example.com', serviceClients: [] }),
      sourcesHad(way, { registeredClients: [accounts], publicUrl: 'http://127.0.0.1:5555', serviceClients: [] }),
      sourcesHad(reversed, { registeredClients: [accounts], publicUrl: undefined, serviceClients: [] }),
    ]).toEqual([
      ['metadata_document', 'dynamic'],
      ['registered', 'dynamic'],
      ['registered', 'dynamic'],
    ]);
  });

  it('give the metadata document at the public address, where it is https', () => {
    expect([metadataDocumentOf('https://runtime.example.com'), metadataDocumentOf('http://127.0.0.1:5555')]).toEqual([
      'https://runtime.example.com/oauth/client.json',
      undefined,
    ]);
  });
});

describe('the client of Auto’s consent service among the sources a runtime has', () => {
  const issuer = 'https://accounts.example.com';

  it('is taken where the service lists the issuer and the way takes a registered client, after the runtime’s own', () => {
    const listed = [{ issuer: `${issuer}/`, client_id: 'auto.apps.example.com' }];
    const had = { registeredClients: [], publicUrl: undefined, serviceClients: listed };

    expect([
      sourcesHad({ issuer }, had),
      sourcesHad({ issuer }, { ...had, registeredClients: [accounts] }),
      sourcesHad({ issuer, clients: ['registered', 'dynamic'] }, had),
      sourcesHad({ issuer, clients: ['metadata_document', 'dynamic'] }, had),
      sourcesHad({ issuer: 'https://elsewhere.example.com' }, had),
    ]).toEqual([['auto'], ['registered', 'auto'], ['auto', 'dynamic'], ['dynamic'], []]);
  });

  it('is the source a start takes where no registered client is had at the issuer, and none is taken where no source is had', () => {
    const had = { registeredClients: [], publicUrl: undefined, serviceClients: [{ issuer, client_id: 'auto' }] };

    expect([
      sourceTakenOf({ issuer }, had),
      sourceTakenOf({ issuer }, { ...had, registeredClients: [accounts] }),
      sourceTakenOf({ issuer, clients: ['metadata_document'] }, had),
    ]).toEqual(['auto', 'registered', undefined]);
  });

  it('is found by an issuer the service lists, or by the issuer its template takes', () => {
    const listed = [{ issuer: 'https://login.example.net/{tenant}/v2.0', client_id: 'auto-tenants' }];

    expect([
      serviceClientAt(listed, 'https://login.example.net/acme.example.org/v2.0')?.client_id,
      serviceClientAt(listed, 'https://login.example.net/a/b/v2.0'),
    ]).toEqual(['auto-tenants', undefined]);
  });
});

describe('the client metadata document', () => {
  const returnAddress = 'https://studio.example.com/connect-return';

  it('names the client by its own address and holds the return address, where the public address is https', () => {
    const address = 'https://runtime.example.com/oauth/client.json';

    expect(clientMetadataDocumentOf('https://runtime.example.com', returnAddress)).toEqual({
      address,
      document: {
        client_id: address,
        client_name: 'Auto Runtime',
        redirect_uris: [returnAddress],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'web',
        token_endpoint_auth_method: 'none',
      },
    });
  });

  it('is none under an http public address or none at all', () => {
    expect([
      clientMetadataDocumentOf('http://127.0.0.1:5555', returnAddress),
      clientMetadataDocumentOf(undefined, returnAddress),
    ]).toEqual([undefined, undefined]);
  });
});
