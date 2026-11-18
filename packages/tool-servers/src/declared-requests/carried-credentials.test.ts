import { Option, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DescribedApiSettings, LinkedServerSettings } from '../openapi/described-api.ts';
import { redactedValuesOf } from '../settings/checked.ts';
import type { AuthSettings, McpServerSettings, StdioServerSettings } from '../settings/server-settings.ts';
import { heldTokens } from '../testing/sent-requests.ts';
import { bearerOf, mayCarryTo, type Bearer } from './carried-credentials.ts';

type Served = Omit<McpServerSettings, 'type' | 'url' | 'headers' | 'auth'>;

const served: Served = {
  name: 'tracker',
  orgs: ['acme'],
  playbooks: null,
  allowed: null,
  marks: { reads: [], acts: [] },
  record_content: true,
  request_id: null,
  secrets: [],
  connection: 'tracker-id',
  provider: 'tracker',
};

const signedIn: AuthSettings = {
  issuer: 'https://auth.tracker.example.com',
  client_id: 'playbook',
  scope: null,
  credential: { kind: 'client_secret', client_secret: Redacted.make('tracker-client-secret-5e1d') },
};

function mcp(headers: Readonly<Record<string, string>>, auth: AuthSettings | null = null): McpServerSettings {
  return {
    ...served,
    type: 'mcp',
    url: 'https://acme.tracker.example.com/mcp',
    headers: redactedValuesOf(headers),
    auth,
  };
}

const api: DescribedApiSettings = {
  ...served,
  type: 'openapi',
  document: { kind: 'url', url: 'https://api.ledgers.example.com/openapi.json' },
  base_url: null,
  headers: new Map(),
  query_params: redactedValuesOf({ api_key: 'ledgers-key-in-the-query-0b7f' }),
  security: new Map(),
  auth: signedIn,
  failure_codes: null,
  api: { baseUrl: 'https://api.ledgers.example.com/v1', operations: [] },
};

const program: StdioServerSettings = { ...served, type: 'stdio', command: 'tracker-mcp', args: [], env: new Map() };

function keyOf(settings: LinkedServerSettings): string | undefined {
  const bearer = bearerOf(settings);
  return bearer?.kind === 'key' ? Redacted.value(bearer.token) : undefined;
}

function tokenOf(settings: LinkedServerSettings): Bearer {
  return Option.getOrThrow(Option.fromNullishOr(bearerOf(settings, heldTokens('tracker-access-token-91aa'))));
}

const at = (address: string): URL => new URL(address);

describe('the credential a request carries', () => {
  it('is the key a connection places in its Authorization header as a bearer token, whatever the case of either', () => {
    expect(
      [
        { Authorization: 'Bearer tracker-key-1' },
        { authorization: 'bearer tracker-key-2' },
        { 'X-Tenant': 'acme-eu', AUTHORIZATION: 'BEARER  tracker-key-3' },
      ].map((headers: Readonly<Record<string, string>>) => keyOf(mcp(headers))),
    ).toEqual(['tracker-key-1', 'tracker-key-2', 'tracker-key-3']);
  });

  it('is none for a key placed any other way, or for a server started as a program', () => {
    expect(
      [
        { 'X-Api-Key': 'tracker-key-1' },
        { Authorization: 'Basic dHJhY2tlcjprZXk=' },
        { Authorization: 'Token tracker-key-2' },
        { Authorization: 'Bearer' },
        { Authorization: 'Bearer tracker key 3' },
        {},
      ].map((headers: Readonly<Record<string, string>>) => bearerOf(mcp(headers))),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect([bearerOf({ ...api, auth: null }), bearerOf(program)]).toEqual([undefined, undefined]);
  });
});

describe('the token of a sign-in a request carries', () => {
  it('is carried to an MCP server of its own by no request while no resource of the sign-in is recorded', () => {
    const token = tokenOf(mcp({}, signedIn));

    expect(token.kind).toBe('token');
    expect(
      ['https://acme.tracker.example.com/mcp', 'https://api.tracker.example.com/hooks'].map((address) =>
        mayCarryTo(token, at(address)),
      ),
    ).toEqual([false, false]);
  });

  it("is the token of an HTTP API, carried under the API's own base URL alone", () => {
    const token = tokenOf(api);

    expect(
      [
        'https://api.ledgers.example.com/v1/hooks',
        'https://api.ledgers.example.com/v1',
        'https://api.ledgers.example.com/v10/hooks',
        'https://api.ledgers.example.com/v1/../admin',
        'https://api.ledgers.example.com/admin',
        'https://ledgers.example.com/v1/hooks',
      ].map((address) => mayCarryTo(token, at(address))),
    ).toEqual([true, true, false, false, false, false]);
  });

  it('carries a token to a resource its sign-in recorded, and to nothing that resource does not cover', () => {
    const token: Bearer = {
      kind: 'token',
      tokens: heldTokens('tracker-access-token-91aa'),
      audience: { recordedResources: ['https://api.tracker.example.com/v2'], unnamedResourceBase: undefined },
    };

    expect(
      [
        'https://api.tracker.example.com/v2/hooks',
        'https://api.tracker.example.com/v3/hooks',
        'https://hooks.example.net/v2/hooks',
      ].map((address) => mayCarryTo(token, at(address))),
    ).toEqual([true, false, false]);
  });

  it('carries a key wherever the rule of origins lets the request go, the rule being the origins of its entry', () => {
    const key = Option.getOrThrow(Option.fromNullishOr(bearerOf(mcp({ Authorization: 'Bearer tracker-key-1' }))));

    expect(mayCarryTo(key, at('https://api.tracker.example.com/hooks'))).toBe(true);
  });
});
