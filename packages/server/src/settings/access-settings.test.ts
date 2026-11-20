import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Environment } from '@on.auto/config';
import { Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('readSettings signing persons in', () => {
  it('signs persons in at the default identity provider once PUBLIC_URL is set, and on every interface no one without it', () => {
    expect([readSettingsOf({ PUBLIC_URL: 'https://runtime.example.com' }).signIn, readSettingsOf({}).signIn]).toEqual([
      { issuer: 'https://clerk.on.auto', publicUrl: 'https://runtime.example.com' },
      undefined,
    ]);
  });

  it.each([
    ['127.0.0.1', 'http://runtime.example.com'],
    ['0.0.0.0', 'http://runtime.example.com'],
    ['0.0.0.0', 'http://192.168.1.20:5555'],
  ])('refuses on HOST=%s the http PUBLIC_URL=%s, naming the setting', (host, publicUrl) => {
    expect(String(errorFrom({ HOST: host, PUBLIC_URL: publicUrl }))).toMatch(/^InvalidSettingsError: PUBLIC_URL: /u);
  });
});

describe('readSettings without PUBLIC_URL', () => {
  it.each([
    [{ HOST: '127.0.0.1' }],
    [{ HOST: 'localhost', PORT: '6000' }],
    [{ HOST: '::1' }],
    [{ HOST: '127.0.0.1', PORT: '0' }],
    [{ HOST: '0.0.0.0' }],
  ] as const)('signs no one in with %j, since PUBLIC_URL has no default', (server) => {
    expect(readSettingsOf(server).signIn).toBeUndefined();
  });

  it('signs persons in at PUBLIC_URL on a loopback address when PUBLIC_URL is set', () => {
    expect(readSettingsOf({ HOST: '127.0.0.1', PUBLIC_URL: 'https://runtime.example.com' }).signIn).toEqual({
      issuer: 'https://clerk.on.auto',
      publicUrl: 'https://runtime.example.com',
    });
  });
});

describe('readSettings rejects invalid credential settings', () => {
  it.each([
    'https://runtime.example.com/',
    'https://runtime.example.com/runtime',
    'https://runtime.example.com?tenant=acme',
    'https://runtime.example.com#top',
    'https://Runtime.example.com',
    'ftp://runtime.example.com',
    'runtime.example.com',
  ])('rejects PUBLIC_URL="%s", which is not an https URL without a path, naming the setting', (publicUrl) => {
    expect(String(errorFrom({ PUBLIC_URL: publicUrl }))).toBe(
      'InvalidSettingsError: SchemaError(Expected an https URL with no path, query or fragment, such as https://runtime.example.com\n  at ["PUBLIC_URL"])',
    );
  });
});

const company = {
  PUBLIC_URL: 'https://auto.example.com',
  OIDC_ISSUER: 'https://login.example.com/acme',
  OIDC_CLIENT_ID: 'auto-runtime',
  OIDC_CLIENT_SECRET: 'a-client-secret-of-the-test',
};

function settingNamedBy(environment: Environment): string | undefined {
  const words = String(errorFrom(environment));
  return /at \["([A-Z_]+)"\]/u.exec(words)?.[1] ?? /^InvalidSettingsError: ([A-Z_]+):/u.exec(words)?.[1];
}

function secretFileHolding(text: string, mode = 0o600): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-oidc-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true });
  });
  const file = join(folder, 'client-secret');
  writeFileSync(file, text, { mode });
  return file;
}

function clientSecretOf(environment: Environment): string | undefined {
  const client = readSettingsOf(environment).openIdConnect?.client;
  return client === undefined ? undefined : Redacted.value(client.clientSecret);
}

describe("readSettings signing people in through the company's identity provider", () => {
  it('reads the provider, the client and the scopes, with the redirect URI under PUBLIC_URL', () => {
    const settings = readSettingsOf({ ...company, OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_post' });

    expect(settings.signIn).toEqual({ issuer: company.OIDC_ISSUER, publicUrl: company.PUBLIC_URL });
    expect(settings.openIdConnect).toMatchObject({
      issuer: company.OIDC_ISSUER,
      client: { clientId: 'auto-runtime' },
      scopes: ['openid', 'profile', 'email'],
      tokenEndpointAuthMethod: 'client_secret_post',
      publicUrl: company.PUBLIC_URL,
      redirectUri: 'https://auto.example.com/auth/oidc/callback',
    });
    expect(clientSecretOf(company)).toBe(company.OIDC_CLIENT_SECRET);
    expect(JSON.stringify(settings)).not.toContain(company.OIDC_CLIENT_SECRET);
  });

  it('reads the secret from OIDC_CLIENT_SECRET_FILE without its line ending, and the scopes OIDC_SCOPES lists', () => {
    const { OIDC_CLIENT_SECRET, ...withoutTheSecret } = company;
    const file = secretFileHolding(`${OIDC_CLIENT_SECRET}\n`);

    const environment = { ...withoutTheSecret, OIDC_CLIENT_SECRET_FILE: file, OIDC_SCOPES: 'openid  email' };

    expect(clientSecretOf(environment)).toBe(OIDC_CLIENT_SECRET);
    expect(readSettingsOf(environment).openIdConnect).toMatchObject({ scopes: ['openid', 'email'] });
  });

  it('reads no client with OIDC_ISSUER alone, so the server registers one, and signs people in at the default identity provider without OIDC_ISSUER', () => {
    const { OIDC_CLIENT_ID: _id, OIDC_CLIENT_SECRET: _secret, ...issuerAlone } = company;
    expect(readSettingsOf(issuerAlone).openIdConnect).toMatchObject({ issuer: company.OIDC_ISSUER, client: undefined });
    expect(readSettingsOf({ PUBLIC_URL: company.PUBLIC_URL })).toMatchObject({
      signIn: { issuer: 'https://clerk.on.auto', publicUrl: company.PUBLIC_URL },
      openIdConnect: undefined,
    });
  });
});

describe("readSettings refusing the company's identity provider", () => {
  it.each<[string, Environment]>([
    ['OIDC_ISSUER', { OIDC_CLIENT_ID: 'auto-runtime', OIDC_CLIENT_SECRET: 'secret', PUBLIC_URL: company.PUBLIC_URL }],
    ['OIDC_ISSUER', { OIDC_CLIENT_ID: 'auto-runtime', PUBLIC_URL: company.PUBLIC_URL }],
    [
      'OIDC_CLIENT_SECRET',
      { OIDC_ISSUER: company.OIDC_ISSUER, OIDC_CLIENT_ID: 'auto-runtime', PUBLIC_URL: company.PUBLIC_URL },
    ],
    ['OIDC_CLIENT_SECRET', { ...company, OIDC_CLIENT_SECRET_FILE: '/run/secrets/oidc' }],
    ['ACCESS_MODE', { ...company, HOST: '127.0.0.1', PUBLIC_URL: 'http://localhost:5555', ACCESS_MODE: 'local' }],
    ['OIDC_SCOPES', { ...company, OIDC_SCOPES: 'profile email' }],
    ['OIDC_ISSUER', { OIDC_ISSUER: company.OIDC_ISSUER, OIDC_CLIENT_ID: 'auto-runtime', OIDC_CLIENT_SECRET: 'secret' }],
    ['OIDC_ISSUER', { ...company, OIDC_ISSUER: 'http://login.example.com/acme' }],
    ['OIDC_ISSUER', { ...company, HOST: '127.0.0.1', PUBLIC_URL: 'http://localhost:5555' }],
    ['OIDC_ISSUER', { ...company, OIDC_ISSUER: 'https://login.example.com/acme?tenant=1' }],
    ['OIDC_ISSUER', { ...company, OIDC_ISSUER: 'https://login.example.com/acme#top' }],
    ['OIDC_CLIENT_ID', { ...company, OIDC_CLIENT_ID: '' }],
    ['OIDC_TOKEN_ENDPOINT_AUTH_METHOD', { ...company, OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'private_key_jwt' }],
  ])('refuses to start, naming %s', (setting, environment) => {
    expect(settingNamedBy(environment)).toBe(setting);
  });

  it('refuses a secret file that does not exist, that the server cannot read, or that is empty', () => {
    const { OIDC_CLIENT_SECRET, ...withoutTheSecret } = company;
    const files = [
      join(tmpdir(), 'auto-runtime-no-such-secret'),
      secretFileHolding(OIDC_CLIENT_SECRET, 0o000),
      secretFileHolding('\n'),
    ];

    expect(files.map((file) => settingNamedBy({ ...withoutTheSecret, OIDC_CLIENT_SECRET_FILE: file }))).toEqual([
      'OIDC_CLIENT_SECRET_FILE',
      'OIDC_CLIENT_SECRET_FILE',
      'OIDC_CLIENT_SECRET_FILE',
    ]);
  });
});

describe('readSettings refusing the settings of the identity service, which it no longer supports', () => {
  const keySet = JSON.stringify({ keys: [{ kty: 'OKP', crv: 'Ed25519', x: 'a-key', kid: 'one' }] });

  it.each<[string, Environment]>([
    ['IDENTITY_ISSUER', { IDENTITY_ISSUER: 'https://identity.example' }],
    ['IDENTITY_ISSUER', { HOST: '127.0.0.1', PUBLIC_URL: 'http://localhost:5555', IDENTITY_ISSUER: 'not a URL' }],
    ['IDENTITY_ISSUER', { ...company, IDENTITY_ISSUER: 'https://identity.example', IDENTITY_JWKS: keySet }],
    ['IDENTITY_JWKS', { PUBLIC_URL: company.PUBLIC_URL, IDENTITY_JWKS: keySet }],
    ['IDENTITY_JWKS_URL', { ...company, IDENTITY_JWKS_URL: 'https://identity.example/jwks' }],
  ])('refuses to start, naming %s, whatever else is set', (setting, environment) => {
    expect(settingNamedBy(environment)).toBe(setting);
  });

  it('takes an empty one as not set', () => {
    expect(
      readSettingsOf({ PUBLIC_URL: company.PUBLIC_URL, IDENTITY_ISSUER: '', IDENTITY_JWKS: '', IDENTITY_JWKS_URL: '' })
        .signIn,
    ).toEqual({ issuer: 'https://clerk.on.auto', publicUrl: company.PUBLIC_URL });
  });
});

function requiredClaimOf(environment: Environment): unknown {
  return readSettingsOf(environment).openIdConnect?.requiredClaim;
}

describe('readSettings given the claim OIDC_REQUIRED_CLAIM requires of the ID Token', () => {
  it('reads the claim and the value, split at the first =, each exactly as written, and nothing where it is empty or not set', () => {
    expect([
      requiredClaimOf({ ...company, OIDC_REQUIRED_CLAIM: 'tenant=acme' }),
      requiredClaimOf({ ...company, OIDC_REQUIRED_CLAIM: 'https://example.com/claims/team=Sales and Support=EU' }),
      requiredClaimOf({ ...company, OIDC_REQUIRED_CLAIM: '' }),
      requiredClaimOf({ PUBLIC_URL: company.PUBLIC_URL, OIDC_REQUIRED_CLAIM: '' }),
      requiredClaimOf(company),
    ]).toEqual([
      { claim: 'tenant', requiredValue: 'acme' },
      { claim: 'https://example.com/claims/team', requiredValue: 'Sales and Support=EU' },
      undefined,
      undefined,
      undefined,
    ]);
  });

  it.each<[string, Environment]>([
    ['without =', { ...company, OIDC_REQUIRED_CLAIM: 'tenant' }],
    ['with no value', { ...company, OIDC_REQUIRED_CLAIM: 'tenant=' }],
    ['with no claim', { ...company, OIDC_REQUIRED_CLAIM: '=acme' }],
    ['with a space after the claim', { ...company, OIDC_REQUIRED_CLAIM: 'tenant =acme' }],
    ['with a space before the claim', { ...company, OIDC_REQUIRED_CLAIM: ' tenant=acme' }],
    ['with a space before the value', { ...company, OIDC_REQUIRED_CLAIM: 'tenant= acme' }],
    ['with a line ending after the value', { ...company, OIDC_REQUIRED_CLAIM: 'tenant=acme\n' }],
    ['without OIDC_ISSUER or PUBLIC_URL', { OIDC_REQUIRED_CLAIM: 'tenant=acme' }],
  ])('refuses to start %s, naming OIDC_REQUIRED_CLAIM', (_case, environment) => {
    expect(settingNamedBy(environment)).toBe('OIDC_REQUIRED_CLAIM');
  });
});
