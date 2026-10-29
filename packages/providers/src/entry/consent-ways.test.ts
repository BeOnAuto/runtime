import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import { adverts, drive, tracker } from '../testing/fixture-providers.ts';

const placesOtherwise =
  'Expected an https URL, or an http URL on a loopback address, written out up to its host, with each placeholder in its place';

const setByTheRuntime = 'which the runtime sets in every authorization request itself';

const together = 'since a way gives its authorization and token endpoints together';

const inOrder =
  'Expected at least one client source, each once, in the order the runtime takes them: registered, metadata_document, and dynamic';

function consentAs(way: Readonly<Record<string, unknown>>) {
  return problemsOf({
    ...drive,
    credentials: [{ kind: 'authorization', issuer: 'https://accounts.drive.example.com', ...way }],
  });
}

describe('the way of consent of an entry', () => {
  it('takes its issuer, its scope, its parameters, its endpoints together and its client sources', () => {
    expect([problemsOf(drive), problemsOf(adverts)]).toEqual([[], []]);
    expect(consentAs({ clients: ['registered', 'metadata_document', 'dynamic'] })).toEqual([]);
  });

  it('refuses a parameter the authorization request sets itself, and takes prompt', () => {
    const parameters = { redirect_uri: 'https://elsewhere.example.com', state: 'kept', prompt: 'consent' };

    expect(consentAs({ parameters })).toEqual([
      ['/credentials/0/parameters/redirect_uri', `Expected no redirect_uri, ${setByTheRuntime}`],
      ['/credentials/0/parameters/state', `Expected no state, ${setByTheRuntime}`],
    ]);
  });
});

describe('the refusals of a way of consent', () => {
  it('refuses an endpoint given without the other, a scope not separated by single spaces, and client sources twice, none or out of the runtime’s order', () => {
    const way = {
      scope: 'files.read  files.write',
      token_endpoint: 'https://accounts.drive.example.com/token',
      clients: ['registered', 'registered'],
    };

    expect(consentAs(way)).toEqual([
      ['/credentials/0/scope', 'Expected scopes separated by single spaces, such as files.read mail.send'],
      ['/credentials/0/authorization_endpoint', `Expected authorization_endpoint beside token_endpoint, ${together}`],
      ['/credentials/0/clients', inOrder],
    ]);
    expect([consentAs({ clients: [] }), consentAs({ clients: ['dynamic', 'registered'] })]).toEqual([
      [['/credentials/0/clients', inOrder]],
      [['/credentials/0/clients', inOrder]],
    ]);
  });

  it('takes the authorization and token endpoints without a revocation endpoint, which a server may not have, and refuses one alone', () => {
    const signedIn = {
      authorization_endpoint: 'https://accounts.drive.example.com/authorize',
      token_endpoint: 'https://accounts.drive.example.com/token',
    };
    const revocation = { revocation_endpoint: 'https://accounts.drive.example.com/revoke' };
    const alone = `beside revocation_endpoint, ${together}`;

    expect([consentAs(signedIn), consentAs(revocation)]).toEqual([
      [],
      [
        ['/credentials/0/authorization_endpoint', `Expected authorization_endpoint ${alone}`],
        ['/credentials/0/token_endpoint', `Expected token_endpoint ${alone}`],
      ],
    ]);
  });
});

describe('the pkce of a way of consent', () => {
  const endpoints = {
    authorization_endpoint: 'https://accounts.drive.example.com/authorize',
    token_endpoint: 'https://accounts.drive.example.com/token',
  };

  it('says none beside the endpoints it writes out, for the clients registered there alone', () => {
    expect([
      consentAs({ ...endpoints, pkce: 'none' }),
      consentAs({ ...endpoints, pkce: 'none', clients: ['registered'] }),
    ]).toEqual([[], []]);
  });

  it('is refused on a way that discovers its server, on one that takes a public client, and as any other value', () => {
    const discovered =
      'Expected pkce only beside authorization_endpoint and token_endpoint, since the metadata of a server the runtime discovers says the challenges it takes';
    const unconfidential =
      'Expected pkce only on a way whose clients are registered alone, confidential clients whose secret binds the code to the client, since nothing but a challenge binds the code of a public client';

    expect([
      consentAs({ pkce: 'none' }),
      consentAs({ ...endpoints, pkce: 'none', clients: ['registered', 'dynamic'] }),
      consentAs({ ...endpoints, pkce: 'none', clients: ['metadata_document'] }),
    ]).toEqual([
      [['/credentials/0/pkce', discovered]],
      [['/credentials/0/pkce', unconfidential]],
      [['/credentials/0/pkce', unconfidential]],
    ]);
    expect(consentAs({ ...endpoints, pkce: 'S256' })).toEqual([['/credentials/0/pkce', 'Expected "none"']]);
  });
});

describe('the addresses of a way of consent', () => {
  it('refuses an endpoint that is not https or holds a placeholder the entry does not give, and a reference among its parameters', () => {
    const way = {
      authorization_endpoint: 'http://accounts.drive.example.com/authorize',
      token_endpoint: 'https://accounts.drive.example.com/{realm}/token',
      revocation_endpoint: 'https://accounts.drive.example.com/revoke',
      parameters: { access_type: '${DRIVE_ACCESS}' },
    };

    expect(consentAs(way)).toEqual([
      [
        '/credentials/0/token_endpoint',
        'Holds {realm}, which no placeholder of the provider and no choice of one gives',
      ],
      ['/credentials/0/authorization_endpoint', placesOtherwise],
      [
        '/credentials/0/parameters/access_type',
        "Holds a reference, which only a header or a query value of a provider's entry holds, for a value whoever runs Auto sets",
      ],
    ]);
  });
});

describe('the fields of a way of consent', () => {
  it('is the way of its kind alone', () => {
    const secretWithClients = { kind: 'secret', in: 'header', name: 'Authorization', clients: ['dynamic'] };

    expect(problemsOf({ ...tracker, credentials: [secretWithClients] })).toEqual([
      ['/credentials/0/clients', 'Expected no clients: a secret way takes in, name, and scheme'],
    ]);
    expect(problemsOf({ ...tracker, credentials: [{ kind: 'none', pkce: 'none' }] })).toEqual([
      ['/credentials/0/pkce', 'Expected no pkce: a none way takes no other field but its description'],
    ]);
    expect(problemsOf({ ...drive, credentials: [{ kind: 'authorization' }] })).toEqual([
      ['/credentials/0/issuer', 'Expected issuer, which an authorization way takes'],
    ]);
  });
});
