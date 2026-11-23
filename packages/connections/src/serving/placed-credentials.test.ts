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
