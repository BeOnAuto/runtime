import type { ServerSettings } from '@on.auto/tool-servers';
import { Redacted, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Credential } from '../registry/credential.ts';
import { placedCredential, readPlaced, type Providing } from './placed-credentials.ts';

const named = { name: 'meetings', type: 'openapi', provider: 'meetings' } as const;

const entry = { document: 'https://meetings.example.com/openapi.json' };

const providing: Providing = { documents: new Map(), values: new Map(), documentServer: undefined };

const asTheApp: Credential = { kind: 'client_credentials', issuer: 'https://login.meetings.example.com' };

const given = { value: Redacted.make('meetings-client-secret-7d2a'), algorithm: undefined };

function settingsOf(credential: Credential, provided: Providing): ServerSettings {
  const placed = placedCredential({ ...named, entry, credential: { ...credential, client_id: 'acme-app' } }, given);
  return Result.getOrThrow(readPlaced(named, placed, { org: 'acme', modelProviders: [], providing: provided }));
}

function parametersOf(settings: ServerSettings): Readonly<Record<string, string>> | undefined {
  return settings.type === 'stdio' ? undefined : settings.auth?.parameters;
}

function authOf(settings: ServerSettings) {
  return settings.type === 'stdio' ? undefined : settings.auth;
}

function pathValuesOf(settings: ServerSettings): Readonly<Record<string, string>> | undefined {
  return settings.type === 'openapi' ? Object.fromEntries(settings.path_values) : undefined;
}

describe('a credential of client credentials placed in the settings of its server', () => {
  it('sends the parameters its way named with the token request, as they are written, and none where it named none', () => {
    const parameters = { grant_type: 'account_credentials', account_id: 'acme-$1' };

    expect([
      parametersOf(settingsOf({ ...asTheApp, parameters }, providing)),
      parametersOf(settingsOf(asTheApp, providing)),
    ]).toEqual([parameters, undefined]);
  });
});

describe('the path values a connection’s way provides, placed in the settings of its server', () => {
  it('are the values of each path parameter, as they are written, and none where its way gives none', () => {
    const pathValues = { userId: 'me', account: 'acme-$1' };

    expect([
      pathValuesOf(settingsOf(asTheApp, { ...providing, path_values: pathValues })),
      pathValuesOf(settingsOf(asTheApp, providing)),
    ]).toEqual([pathValues, {}]);
  });
});

describe('a credential that signs an assertion for a token request of its own, placed in the settings of its server', () => {
  it('sends the assertion to the address its way named, reading the token where the way says, as they are written', () => {
    const tokenRequest = {
      method: 'POST',
      url: 'https://api.meetings.example.com/apps/installations/7$1/tokens',
      issued: { access_token: '/to$ken', expires_at: '/expires_at' },
    } as const;
    const ofTheApp: Credential = {
      kind: 'jwt_bearer',
      issuer: 'https://api.meetings.example.com/apps',
      token_request: tokenRequest,
    };
    const withNoEnd = { ...tokenRequest, issued: { access_token: '/token' } };
    const { token_request: _request, ...withNoRequest } = ofTheApp;

    expect([
      authOf(settingsOf(ofTheApp, providing)),
      authOf(settingsOf({ ...ofTheApp, token_request: withNoEnd }, providing))?.token_request,
      authOf(settingsOf(withNoRequest, providing)),
    ]).toMatchObject([
      { grant: 'jwt_bearer', client_id: 'acme-app', token_request: tokenRequest, credential: { kind: 'private_key' } },
      withNoEnd,
      { grant: 'jwt_bearer' },
    ]);
    expect(authOf(settingsOf(withNoRequest, providing))).not.toHaveProperty('token_request');
  });
});
