import type { SettingProblem } from '@on.auto/config';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readToolServerSettings } from '../index.ts';
import { authOf } from '../settings/server-settings.ts';
import { isUnderTheIssuer, tokenRequestIssuesOf } from './token-request-checks.ts';
import type { TokenRequest } from './token-requests.ts';

const issuer = 'https://api.service.example.com/apps';

describe('the address of a token request of its own', () => {
  it.each([
    ['https://api.service.example.com/apps/installations/7/tokens', true],
    ['https://api.service.example.com/apps', true],
    ['https://api.service.example.com/apps/', true],
    ['https://api.service.example.com/applications/7/tokens', false],
    ['https://api.service.example.com/users/7/tokens', false],
    ['https://other.service.example.com/apps/7/tokens', false],
    ['http://api.service.example.com/apps/7/tokens', false],
    ['https://ada:pw@api.service.example.com/apps/7/tokens', false],
    ['https://api.service.example.com:8443/apps/7/tokens', false],
    ['not an address', false],
  ])('%s lies under the issuer: %s', (url, under) => {
    expect(isUnderTheIssuer(issuer, url)).toBe(under);
  });

  it('lies under an issuer at the root of its host anywhere on that host, and under no issuer that is no address', () => {
    expect(isUnderTheIssuer('https://api.service.example.com', 'https://api.service.example.com/x/tokens')).toBe(true);
    expect(isUnderTheIssuer('issuer', 'https://api.service.example.com/x/tokens')).toBe(false);
  });
});

const request: TokenRequest = {
  method: 'POST',
  url: `${issuer}/installations/7/tokens`,
  issued: { access_token: '/token', expires_at: '/expires_at' },
};

const refusedRequests: readonly (readonly [string, Partial<TokenRequest>, readonly (readonly string[])[]])[] = [
  ['an address off https', { url: 'http://api.service.example.com/apps/7' }, [['url']]],
  ['an address outside the issuer', { url: 'https://api.service.example.com/users/7' }, [['url']]],
  [
    'a pointer to the token that is no JSON Pointer',
    { issued: { access_token: 'token' } },
    [['issued', 'access_token']],
  ],
  [
    'a pointer to its end that is no JSON Pointer',
    { issued: { access_token: '/token', expires_at: 'expires_at' } },
    [['issued', 'expires_at']],
  ],
];

describe('a token request of its own', () => {
  it('is taken with an https address under the issuer and a JSON Pointer to the token and to its end', () => {
    expect(tokenRequestIssuesOf(issuer, request)).toEqual([]);
  });

  it.each(refusedRequests)('is refused with %s', (_case, changes, paths) => {
    expect(tokenRequestIssuesOf(issuer, { ...request, ...changes }).map(({ path }) => path)).toEqual(paths);
  });
});

const server = { url: 'https://mcp.service.example.com/mcp', org: 'acme' };

const ofTheApp = {
  issuer,
  client_id: '1234567',
  private_key: '${SERVICE_PRIVATE_KEY}',
  algorithm: 'RS256',
  grant: 'jwt_bearer',
};

const environment = { SERVICE_PRIVATE_KEY: 'a private key' };

function read(auth: Readonly<Record<string, unknown>>) {
  return readToolServerSettings(
    { ...environment, TOOL_SERVERS: JSON.stringify({ service: { ...server, auth } }) },
    { modelProviders: [] },
  );
}

function placeOf({ setting, pointer = '' }: SettingProblem): string {
  return `${setting}${pointer}`;
}

const refusedAuths: readonly (readonly [string, Readonly<Record<string, unknown>>, string])[] = [
  ['beside another grant', { grant: 'client_credentials' }, '/service/auth/token_request'],
  ['beside a subject', { subject: 'inbox@acme.example.com' }, '/service/auth/token_request'],
  ['beside a scope', { scope: 'read' }, '/service/auth/token_request'],
  [
    'with an address outside the issuer',
    { token_request: { ...request, url: 'https://api.service.example.com/users/7' } },
    '/service/auth/token_request/url',
  ],
  [
    'with a value that looks like a credential',
    { token_request: { ...request, issued: { access_token: 'ghs_0123456789abcdefghijklmnop' } } },
    '/service/auth/token_request/issued/access_token',
  ],
];

describe('the token request of an auth block', () => {
  it('is read beside grant jwt_bearer', () => {
    const { servers } = Effect.runSync(read({ ...ofTheApp, token_request: request }));

    expect(servers.map((each) => authOf(each)?.token_request)).toEqual([request]);
  });

  it.each(refusedAuths)('is refused %s', (_case, changes, pointer) => {
    const { problems } = Effect.runSync(Effect.flip(read({ ...ofTheApp, token_request: request, ...changes })));

    expect(problems.map((problem) => placeOf(problem))).toEqual([`TOOL_SERVERS${pointer}`]);
  });
});
