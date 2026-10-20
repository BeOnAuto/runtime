import { Result, Schema, SchemaIssue } from 'effect';
import { describe, expect, it } from 'vitest';

import { CredentialSchema } from './credential.ts';

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
          'Expected no in: an authorization credential takes issuer, scope, parameters, authorization_endpoint, token_endpoint, revocation_endpoint, clients, client_id, and client_source',
        ],
      ],
      [['/client_source', 'Expected no client_source: a secret credential takes name, in, and scheme']],
    ]);
  });
});
